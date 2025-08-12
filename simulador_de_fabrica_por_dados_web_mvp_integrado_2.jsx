// Usando React global (CDN)
const {useEffect, useRef, useState} = React;

/* ===========================
   Utilidades
=========================== */
const MEAN_DIE = 3.5;
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===========================
   Parâmetros padrão
=========================== */
const defaultParams = {
  fator: [2, 2, 2, 1, 2, 2],   // multiplicadores das 6 máquinas
  estoqueInicial: [0, 0, 0, 0, 0], // buffers B2..B6 (antes das M2..M6)
  preco: 4,
  custoVariavel: 1,      // TVC (material) — usado em TOC
  custoFixo: 0.5,        // D.O. por rodada
  custoInventario: 0.3,  // h por peça parada/rodada (custo manutenção)
  politica: { modo: "restricao", gargalo: 4, bufferAlvoDias: 3 }, // DBR
  semente: 12345,
  ltMetodo: 4,           // só mantemos um card de lead time (cálculo compatível)
  ltTransfer: 1,
  ltMcRuns: 200,
};

/* ===========================
   Estado inicial
=========================== */
function estadoInicial(p) {
  const visIni = [Infinity, ...p.estoqueInicial]; // ∞ antes da M1 em push
  return {
    rodada: 0,
    dados: [0,0,0,0,0,0],
    capacidade: [0,0,0,0,0,0],
    estoqueAntes: visIni.slice(),  // usado na PRÓXIMA rodada
    producao: [0,0,0,0,0,0],
    estoqueDepois: visIni.slice(), // final da rodada executada
    visAntes: visIni.slice(),      // estoque inicial "visual" da rodada
    th: 0,
    thAcum: 0,

    // ----- Métricas clássicas -----
    wip: 0,            // soma dos buffers B2..B6 no FINAL da rodada
    leadTime: 0,

    // ----- ECONOMIA / TOC -----
    ganhoTOC_Ac: 0,    // "Ganho" TOC acumulado = (p - cv) * TH_acum
    doAcum: 0,         // D.O. acumulada (custo fixo)
    invMaintAcum: 0,   // custo manutenção de estoque acumulado = h * WIP_rodada
    invTOCAcum: 0,     // Inventário TOC acumulado = cv * produção_M1_rodada
    lucroTOC: 0,       // Ganho - D.O.
    roiTOC: 0,         // (Ganho - D.O.) / Inventário TOC
  };
}

/* ===========================
   DBR: buffer alvo em peças
=========================== */
function diasParaPecas(p) {
  const k = p.politica.gargalo - 1;
  const mediaCap = MEAN_DIE * (p.fator[k] ?? 1);
  const alvo = p.politica.bufferAlvoPecas ?? Math.round((p.politica.bufferAlvoDias ?? 0) * mediaCap);
  return Math.max(0, alvo);
}

/* ===========================
   Lead time (simples)
=========================== */
function calcularLeadTime(p, ctx) {
  // Lei de Little (macro): WIP / THmedio
  return ctx.thMedio > 0 ? ctx.wip / ctx.thMedio : 0;
}

/* ===========================
   Um passo de simulação (atraso 1 rodada)
=========================== */
function passo(p, s, rng) {
  // 1) Sorteio e capacidades
  const dados = Array.from({ length: 6 }, () => 1 + Math.floor(rng() * 6));
  const cap = dados.map((d, i) => Math.floor(d * p.fator[i]));

  // 2) Estoque inicial da rodada
  const estoqueInicial = [...s.estoqueAntes];

  // 3) Política DBR em M1
  let liberar = 0;
  let estoque0 = Infinity;
  if (p.politica.modo === "restricao") {
    const k = p.politica.gargalo - 1;
    const alvo = diasParaPecas(p);
    const bufAtual = Number.isFinite(estoqueInicial[k]) ? Number(estoqueInicial[k]) : 0;
    liberar = Math.max(0, alvo - bufAtual);
    cap[0] = Math.min(cap[0], liberar);
    estoque0 = liberar; // só isso está liberado para M1 nesta rodada
  }

  // 4) Produção efetiva com atraso 1 rodada
  const X = Array(6).fill(0);
  const estoqueFinal = [...estoqueInicial];

  // M1 consome de estoque0 (∞ no push; liberar no DBR)
  X[0] = Math.min(cap[0], Number.isFinite(estoque0) ? Number(estoque0) : cap[0]);
  const finalM1 = p.politica.modo === "restricao" ? Math.max(0, (Number.isFinite(estoque0) ? Number(estoque0) : 0) - X[0]) : Infinity;

  for (let i = 1; i < 6; i++) {
    const disp = Number.isFinite(estoqueInicial[i]) ? estoqueInicial[i] : 0;
    const prod = Math.min(cap[i], disp);
    X[i] = prod;
    estoqueFinal[i] = disp - prod; // sem somar X[i-1] (entra na próxima rodada)
  }
  estoqueFinal[0] = finalM1;

  // 5) Preparar ESTOQUE INICIAL da PRÓXIMA rodada
  const proxAntes = [...estoqueFinal];
  for (let i = 1; i < 6; i++) {
    proxAntes[i] = (Number.isFinite(proxAntes[i]) ? proxAntes[i] : 0) + X[i - 1];
  }
  proxAntes[0] = p.politica.modo === "restricao" ? finalM1 : Infinity;

  // 6) Métricas
  const th = X[5];
  const thAcum = s.thAcum + th;

  // WIP = soma dos buffers B2..B6 do FINAL da rodada
  const wip = (estoqueFinal.slice(1) || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const thMedio = thAcum / (s.rodada + 1);
  const lead = calcularLeadTime(p, { wip, thMedio });

  // ----- ECONOMIA / TOC -----
  const doRound = p.custoFixo;
  const invMaintRound = p.custoInventario * wip;
  const invTOCRound = p.custoVariavel * X[0];           // material que entrou (M1)
  const ganhoRound = (p.preco - p.custoVariavel) * th;  // Ganho TOC da rodada

  const doAc = s.doAcum + doRound;
  const invMaintAc = s.invMaintAcum + invMaintRound;
  const invTOCAc = s.invTOCAcum + invTOCRound;
  const ganhoTOC_Ac = s.ganhoTOC_Ac + ganhoRound;
  const lucroTOC = ganhoTOC_Ac - doAc;
  const roiTOC = invTOCAc > 0 ? (lucroTOC / invTOCAc) : 0;

  return {
    rodada: s.rodada + 1,
    dados,
    capacidade: cap,
    estoqueAntes: proxAntes,
    producao: X,
    estoqueDepois: estoqueFinal,
    visAntes: estoqueInicial,

    th,
    thAcum,
    wip,
    leadTime: lead,

    ganhoTOC_Ac,
    doAcum: doAc,
    invMaintAcum: invMaintAc,
    invTOCAcum: invTOCAc,
    lucroTOC,
    roiTOC,
  };
}

/* ===========================
   Componentes de UI
=========================== */
function NumberInput({ label, value, onChange, step = 1, min = 0 }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm py-1">
      <span className="text-gray-700">{label}</span>
      <input
        type="number"
        className="w-24 rounded border px-2 py-1 text-right"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="grid grid-cols-6 gap-2">{children}</div>
    </div>
  );
}

function Cell({ value, infinity = false, muted = false }) {
  const display = infinity ? "∞" : (Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : "∞");
  return (
    <div className={`rounded-xl border px-2 py-3 text-center ${muted ? "bg-gray-50 text-gray-400" : "bg-yellow-50"}`}>
      <div className="font-mono">{display}</div>
    </div>
  );
}

function Metric({ label, value, precision = 0 }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3 text-center border">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold font-mono">
        {typeof value === "number" ? value.toFixed(precision) : value}
      </div>
    </div>
  );
}

/* ===========================
   App principal
=========================== */
function App() {
  const [params, setParams] = useState({ ...defaultParams });
  const [estado, setEstado] = useState(() => estadoInicial({ ...defaultParams }));
  const [rodarN, setRodarN] = useState(1);
  const [autoplay, setAutoplay] = useState(false);
  const rngRef = useRef(() => Math.random());

  useEffect(() => {
    rngRef.current = mulberry32(params.semente);
  }, [params.semente]);

  function aplicarParametros(next) {
    const p = { ...params, ...next };
    setParams(p);
    setEstado(estadoInicial(p));
    setAutoplay(false);
  }

  // Atualiza política SEM reset (DBR em tempo real)
  function aplicarParametrosSoft(next) {
    const p = { ...params, ...next };
    setParams(p);
    if (next.politica) {
      setEstado((prev) => {
        const alvo = p.politica.modo === "restricao" ? diasParaPecas(p) : Infinity;
        const vis0 = alvo;
        return { ...prev, visAntes: [vis0, ...((prev.visAntes?.slice(1) || []))] };
      });
    }
  }

  function rodarPasso() {
    setEstado((s) => passo(params, s, rngRef.current));
  }
  function rodarNLote(n) { for (let i = 0; i < n; i++) rodarPasso(); }

  useEffect(() => {
    if (!autoplay) return;
    const id = setInterval(() => rodarPasso(), 120);
    return () => clearInterval(id);
  }, [autoplay, params]);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 p-4">
        {/* Sidebar */}
        <aside className="bg-white rounded-2xl shadow p-4 space-y-3">
          <h2 className="text-lg font-semibold">Parâmetros</h2>

          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-600">Fator por máquina</div>
            {params.fator.map((v, i) => (
              <NumberInput key={i} label={`Máquina ${i + 1}`} value={v} step={0.1} min={0}
                onChange={(x) => aplicarParametros({ fator: params.fator.map((fv, idx) => (idx === i ? x : fv)) })} />
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-600">Estoque inicial (antes de M2..M6)</div>
            {params.estoqueInicial.map((v, i) => (
              <NumberInput key={i} label={`Buffer ${i + 2}`} value={v} step={1} min={0}
                onChange={(x) => aplicarParametros({ estoqueInicial: params.estoqueInicial.map((ev, idx) => (idx === i ? Math.max(0, Math.floor(x)) : ev)) })} />
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-600">Política</div>
            <div className="flex items-center gap-2">
              <select className="border rounded px-2 py-1" value={params.politica.modo}
                onChange={(e) => aplicarParametrosSoft({ politica: { ...params.politica, modo: e.target.value } })}>
                <option value="livre">Livre (push)</option>
                <option value="restricao">Subordinar à restrição (DBR)</option>
              </select>
              <label className="text-sm">Gargalo:</label>
              <select className="border rounded px-2 py-1" value={params.politica.gargalo}
                onChange={(e) => aplicarParametrosSoft({ politica: { ...params.politica, gargalo: parseInt(e.target.value,10) } })}>
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{`M${n}`}</option>)}
              </select>
            </div>
            <NumberInput label="Buffer-alvo (dias)" value={params.politica.bufferAlvoDias ?? 0} step={0.5}
              onChange={(x) => aplicarParametrosSoft({ politica: { ...params.politica, bufferAlvoDias: x, bufferAlvoPecas: undefined } })} />
            <NumberInput label="Buffer-alvo (peças)" value={params.politica.bufferAlvoPecas ?? 0} step={1}
              onChange={(x) => aplicarParametrosSoft({ politica: { ...params.politica, bufferAlvoPecas: Math.max(0, Math.floor(x)) } })} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-600">Economia</div>
            <NumberInput label="Preço de venda (p)" value={params.preco} step={0.5}
              onChange={(x) => aplicarParametros({ preco: x })} />
            <NumberInput label="Custo variável (cv)" value={params.custoVariavel} step={0.5}
              onChange={(x) => aplicarParametros({ custoVariavel: x })} />
            <NumberInput label="Custo fixo por rodada (cf)" value={params.custoFixo} step={0.1}
              onChange={(x) => aplicarParametros({ custoFixo: x })} />
            <NumberInput label="Custo manutenção (h)" value={params.custoInventario} step={0.1}
              onChange={(x) => aplicarParametros({ custoInventario: x })} />
            <NumberInput label="Semente RNG" value={params.semente} step={1}
              onChange={(x) => aplicarParametros({ semente: Math.floor(x) })} />
          </div>
        </aside>

        {/* Painel principal */}
        <main className="bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Fábrica (Jogo dos Dados)</h1>
            <div className="flex items-center gap-2">
              <button onClick={() => setAutoplay((a) => !a)} className={`px-3 py-1 rounded text-sm ${autoplay ? "bg-red-500 text-white" : "bg-emerald-500 text-white"}`}>{autoplay ? "Pausar" : "Autoplay"}</button>
              <button onClick={() => rodarPasso()} className="px-3 py-1 rounded bg-blue-600 text-white text-sm">Rodar 1</button>
              <div className="flex items-center gap-2">
                <input type="number" value={rodarN} onChange={(e) => setRodarN(Math.max(1, parseInt(e.target.value || "1", 10)))} className="w-20 border rounded px-2 py-1 text-right text-sm" />
                <button onClick={() => rodarNLote(rodarN)} className="px-3 py-1 rounded bg-blue-100 hover:bg-blue-200 text-sm">Rodar N</button>
              </div>
              <button onClick={() => { setEstado(estadoInicial(params)); setAutoplay(false); }} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm">Recomeçar</button>
            </div>
          </div>

          {/* Métricas de topo */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
            <Metric label="Rodada" value={estado.rodada} />
            <Metric label="Lead time (método 4)" value={estado.leadTime} precision={2} />
            <Metric label="TH médio" value={estado.rodada ? estado.thAcum/estado.rodada : 0} precision={3} />
            <Metric label="WIP" value={estado.wip} />
            <Metric label="Ganho (R$) — TOC" value={estado.ganhoTOC_Ac} precision={2} />
            <Metric label="Lucro TOC (R$)" value={estado.lucroTOC} precision={2} />
          </div>

          {/* Dados das máquinas */}
          <div className="mt-4">
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="relative">
                  {i === (params.politica.gargalo - 1) && params.politica.modo === "restricao" && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] px-1 py-0.5 rounded bg-cyan-600 text-white">Restr</span>
                  )}
                  <div className="rounded-xl border p-2 text-center">
                    <div className="text-xs font-semibold text-blue-700">Máquina {i + 1}</div>
                    <div className="text-3xl font-mono">{estado.dados[i] || "·"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Estoques e produção */}
          <div className="mt-4 space-y-2">
            <Row label="Estoque Anterior">
              <Cell value={Number.isFinite(estado.visAntes?.[0]) ? estado.visAntes?.[0] : Infinity} infinity={params.politica.modo !== "restricao"} />
              {(estado.visAntes?.slice(1) || []).map((b, i) => <Cell key={i} value={b} />)}
            </Row>
            <Row label="Produção">
              {estado.producao.map((x, i) => <Cell key={i} value={x} />)}
            </Row>
            <Row label="Estoque Final">
              <Cell value={0} muted />
              {(estado.estoqueDepois.slice(1) || []).map((b, i) => <Cell key={i} value={b} />)}
            </Row>
          </div>

          {/* Resumos */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <Metric label="Peças produzidas" value={estado.thAcum} precision={0} />
            <Metric label="D.O. (R$) — acumulada" value={estado.doAcum} precision={2} />
            <Metric label="Custo manutenção (R$)" value={estado.invMaintAcum} precision={2} />
            <Metric label="Inventário TOC (R$ investidos)" value={estado.invTOCAcum} precision={2} />
            <Metric label="ROI TOC" value={estado.roiTOC} precision={3} />
          </div>
        </main>
      </div>
    </div>
  );
}

// expõe App para o fallback do index.html
window.App = App;
