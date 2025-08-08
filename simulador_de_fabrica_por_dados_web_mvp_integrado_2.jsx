

/**
 * Simulador de Fábrica por Dados — versão com "atraso de 1 rodada" entre máquinas
 * e política DBR que NÃO reseta o jogo quando ativada.
 */
 
 // Usando React global (CDN):
const { useEffect, useRef, useState } = React;


// ===== Tipos =====
interface Politica {
  modo: "livre" | "restricao";
  gargalo: 1 | 2 | 3 | 4 | 5 | 6;
  bufferAlvoPecas?: number;
  bufferAlvoDias?: number;
}

interface Params {
  fator: number[];           // tamanho 6
  estoqueInicial: number[];  // tamanho 5 (antes de M2..M6)
  preco: number;
  custoVariavel: number;
  custoFixo: number;
  custoInventario: number;
  politica: Politica;
  semente: number;
  // ------ Lead time config ------
  ltMetodo?: 1 | 2 | 3 | 4;     // 1=Little, 2=Estágios, 3=Janela min/max, 4=Monte Carlo
  ltTransfer?: number;          // atraso entre estágios em rodadas (default 1)
  ltMcRuns?: number;            // simulações para MC
}

interface Estado {
  rodada: number;
  dados: number[];          // 6
  capacidade: number[];     // 6 (inteiros)
  // estoqueAntes = valores que SERÃO usados na PRÓXIMA rodada
  estoqueAntes: number[]; // [∞|liberar, b2..b6]
  producao: number[];       // X1..X6
  // estoqueDepois = estoque FINAL da rodada executada (para exibição)
  estoqueDepois: number[];
  // visAntes = estoque INICIAL da rodada executada (para exibição)
  visAntes: number[];
  th: number;               // X6
  thAcum: number;
  wip: number;              // soma buffers (i>=2) do estoque FINAL da rodada
  leadTime: number;         // WIP / THmedio
  ganho: number;
  inv: number;              // custo de inventário acumulado
  do: number;               // despesa operacional fixa acumulada
  lucro: number;            // ganho - do - inv - cv * THacum
}

// ===== Utilitários =====
const MEAN_DIE = 3.5;
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ===== Parâmetros padrão =====
const defaultParams: Params = {
  fator: [2, 2, 2, 1, 2, 2],
  estoqueInicial: [0, 0, 0, 0, 0],
  preco: 4,
  custoVariavel: 0,
  custoFixo: 0,
  custoInventario: 0,
  politica: { modo: "livre", gargalo: 4, bufferAlvoDias: 3 },
  semente: 12345,
  ltMetodo: 1,
  ltTransfer: 1,
  ltMcRuns: 200,
};

function diasParaPecas(p: Params): number {
  const k = p.politica.gargalo - 1;
  const mediaCap = MEAN_DIE * (p.fator[k] ?? 1);
  const alvo = p.politica.bufferAlvoPecas ?? Math.round((p.politica.bufferAlvoDias ?? 0) * mediaCap);
  return Math.max(0, alvo);
}

function estadoInicial(p: Params): Estado {
  const visIni = [Infinity, ...p.estoqueInicial];
  return {
    rodada: 0,
    dados: [0, 0, 0, 0, 0, 0],
    capacidade: [0, 0, 0, 0, 0, 0],
    estoqueAntes: visIni.slice(),      // usado na PRÓXIMA rodada (igual ao inicial na 0)
    producao: [0, 0, 0, 0, 0, 0],
    estoqueDepois: visIni.slice(),     // final da "rodada -1" (igual ao inicial)
    visAntes: visIni.slice(),          // estoque inicial da rodada executada (UI)
    th: 0,
    thAcum: 0,
    wip: p.estoqueInicial.reduce((a, b) => a + b, 0),
    leadTime: 0,
    ganho: 0,
    inv: 0,
    do: 0,
    lucro: 0,
  };
}

// ===== Lead time estimators =====
function capacidadeMedia(fator: number) { return MEAN_DIE * fator; }
function calcularLeadTime(
  p: Params,
  ctx: { wip: number; thMedio: number; visAntes: number[] }
): number {
  const metodo = p.ltMetodo ?? 1;
  const transfer = p.ltTransfer ?? 1;
  const N = 6;
  if (metodo === 1) {
    // Little's Law macro: WIP / THmedio
    return ctx.thMedio > 0 ? ctx.wip / ctx.thMedio : 0;
  }
  if (metodo === 2) {
    // Analítico por estágio (espera + serviço + transferência)
    let total = 0;
    for (let i = 0; i < N; i++) {
      const mu = Math.max(1e-6, capacidadeMedia(p.fator[i] ?? 1));
const Q = i === 0
    ? (p.politica.modo === "restricao"
        ? (Number.isFinite(ctx.visAntes[0]) ? (ctx.visAntes[0] as number) : 0)
        : 0)
    : (Number.isFinite(ctx.visAntes[i]) ? (ctx.visAntes[i] as number) : 0);
      const wait = Q / mu;
      const service = 1 / mu;
      const trans = i < N - 1 ? transfer : 0;
      total += wait + service + trans;
    }
    return total;
  }
  if (metodo === 3) {
    // Janela [min, max] usando capacidades mín/max por estágio
    const sumFor = (capPerFace: number) => {
      let tot = 0;
      for (let i = 0; i < N; i++) {
        const mu = Math.max(1e-6, capPerFace * (p.fator[i] ?? 1));
		 const Q = i === 0
		   ? (p.politica.modo === "restricao"
			   ? (Number.isFinite(ctx.visAntes[0]) ? Number(ctx.visAntes[0]) : 0)
			   : 0)
		   : (Number.isFinite(ctx.visAntes[i]) ? Number(ctx.visAntes[i]) : 0);
        const wait = Q / mu;
        const service = 1 / mu;
        const trans = i < N - 1 ? transfer : 0;
        tot += wait + service + trans;
      }
      return tot;
    };
    const ltMin = sumFor(6); // melhor caso
    const ltMax = sumFor(1); // pior caso
    return (ltMin + ltMax) / 2; // exibir média; (podemos mostrar a janela na UI futuramente)
  }
  if (metodo === 4) {
    // Monte Carlo (aprox.) — processa fila de cada estágio sequencialmente
    const runs = Math.max(10, p.ltMcRuns ?? 200);
    const localRng = mulberry32((p.semente ?? 1) + 987654321);
    const sampleOne = () => {
      let t = 0;
      for (let i = 0; i < N; i++) {
        const fator = p.fator[i] ?? 1;
        // fila à frente do pedido na chegada a Mi
        const Q = (i === 0)
          ? 0
          : (Number.isFinite(ctx.visAntes[i]) ? (ctx.visAntes[i] as number) : 0);
        let restante = Q + 1; // inclui nosso pedido
        while (restante > 0) {
          const cap = (1 + Math.floor(localRng() * 6)) * fator;
          const proc = Math.min(restante, cap);
          restante -= proc;
          t += 1; // uma rodada passada
          if (restante <= 0 && i < N - 1) t += transfer; // transferência
        }
      }
      return t;
    };
    let acc = 0;
    for (let r = 0; r < runs; r++) acc += sampleOne();
    return acc / runs;
  }
  return ctx.thMedio > 0 ? ctx.wip / ctx.thMedio : 0;
}

// ===== Motor com atraso de 1 rodada =====
function passo(p: Params, s: Estado, rng: () => number): Estado {
  // 1) Sorteio e capacidades
  const dados = Array.from({ length: 6 }, () => 1 + Math.floor(rng() * 6));
  const cap = dados.map((d, i) => Math.floor(d * p.fator[i]));

  // 2) Captura o ESTOQUE INICIAL da rodada (para exibição e consumo)
  const estoqueInicial = [...s.estoqueAntes];

  // 3) Política: determinar liberação na M1 (não empurra para M2 nesta rodada)
  let liberar = 0;
  let estoque0 = Infinity;
  if (p.politica.modo === "restricao") {
    const k = p.politica.gargalo - 1; // índice 0..5
    const alvo = diasParaPecas(p);
    const bufAtual = Number.isFinite(estoqueInicial[k]) ? (estoqueInicial[k] as number) : 0;
    liberar = Math.max(0, alvo - bufAtual);
    cap[0] = Math.min(cap[0], liberar);
    estoque0 = liberar; // estoque disponível para M1 nesta rodada
  }

  // 4) Produção efetiva com ATRASO de 1 rodada
  const X = Array(6).fill(0);
  const estoqueFinal = [...estoqueInicial];

  // M1 consome do estoque0 (∞ no push; liberar no DBR)
  X[0] = Math.min(cap[0], Number.isFinite(estoque0) ? Number(estoque0) : cap[0]);
  // No final da rodada, consideramos 0/saldo para visualização em M1
   const finalM1 = p.politica.modo === "restricao"
   ? Math.max(0, (Number.isFinite(estoque0) ? Number(estoque0) : 0) - X[0])
   : Infinity;

  for (let i = 1; i < 6; i++) {
    const disp = Number.isFinite(estoqueInicial[i]) ? estoqueInicial[i] : 0;
    const prod = Math.min(cap[i], disp);
    X[i] = prod;
    estoqueFinal[i] = disp - prod; // NÃO somar X[i-1] nesta rodada (entra só na próxima)
  }
  estoqueFinal[0] = finalM1; // para consistência

  // 5) Preparar ESTOQUE INICIAL da PRÓXIMA rodada (delay de 1 rodada)
  const proxAntes = [...estoqueFinal];
  for (let i = 1; i < 6; i++) {
    const add = X[i - 1];
    proxAntes[i] = (Number.isFinite(proxAntes[i]) ? proxAntes[i] : 0) + add;
  }
  // M1 na próxima rodada: ∞ no push; no DBR, será recalculado na próxima rodada
  proxAntes[0] = p.politica.modo === "restricao" ? finalM1 : Infinity;

  // 6) Métricas
  const th = X[5];
  const thAcum = s.thAcum + th;
  const wip = (estoqueFinal.slice(1) || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const thMedio = thAcum / (s.rodada + 1);
  // --- Lead time estimate by selected method ---
  const lead = calcularLeadTime(p, { wip, thMedio, visAntes: estoqueInicial });

  const ganho = s.ganho + p.preco * th;
  const inv = s.inv + p.custoInventario * wip;
  const DO = s.do + p.custoFixo;
  const lucro = ganho - DO - inv - p.custoVariavel * thAcum;

  return {
    rodada: s.rodada + 1,
    dados,
    capacidade: cap,
    estoqueAntes: proxAntes,   // usado na PRÓXIMA rodada
    producao: X,
    estoqueDepois: estoqueFinal,
    visAntes: estoqueInicial,  // estoque inicial usado nesta rodada (UI)
    th,
    thAcum,
    wip,
    leadTime: lead,
    ganho,
    inv,
    do: DO,
    lucro,
  };
}

// ===== UI helpers =====
function NumberInput({ label, value, onChange, step = 1, min = 0 }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="grid grid-cols-6 gap-2">{children}</div>
    </div>
  );
}

function Cell({ value, infinity = false, muted = false }: { value: number; infinity?: boolean; muted?: boolean }) {
  const display = infinity ? "∞" : (Number.isFinite(value) ? Math.max(0, Math.floor(value)).toString() : "∞");
  return (
    <div className={`rounded-xl border px-2 py-3 text-center ${muted ? "bg-gray-50 text-gray-400" : "bg-yellow-50"}`}>
      <div className="font-mono">{display}</div>
    </div>
  );
}

function Metric({ label, value, precision = 0 }: { label: string; value: number; precision?: number }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3 text-center border">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold font-mono">{Number(value).toFixed(precision)}</div>
    </div>
  );
}

// ===== App =====
function App() {
  const [params, setParams] = useState<Params>({ ...defaultParams });
  const [estado, setEstado] = useState<Estado>(() => estadoInicial({ ...defaultParams }));
  const [thMediaSerie, setThMediaSerie] = useState<number[]>([]);
  const [rodarN, setRodarN] = useState(1);
  const [autoplay, setAutoplay] = useState(false);
  const rngRef = useRef<() => number>(() => Math.random());

  useEffect(() => {
    rngRef.current = mulberry32(params.semente);
  }, [params.semente]);

  function aplicarParametros(next: Partial<Params>) {
    const p = { ...params, ...next } as Params;
    setParams(p);
    setEstado(estadoInicial(p));
    setThMediaSerie([]);
    setAutoplay(false);
  }

  // Atualiza política SEM reset (DBR em tempo real)
  function aplicarParametrosSoft(next: Partial<Params>) {
    const p = { ...params, ...next } as Params;
    setParams(p);
    if (next.politica) {
      setEstado((prev) => {
        const alvo = p.politica.modo === "restricao" ? diasParaPecas(p) : Infinity;
        const vis0 = alvo; // estoques visuais de M1 nesta rodada
        return { ...prev, visAntes: [vis0, ...((prev.visAntes?.slice(1) || []) || [0,0,0,0,0])] } as Estado;
      });
    }
  }

  function rodarPasso() {
    setEstado((s) => {
      const prox = passo(params, s, rngRef.current);
      const media = prox.thAcum / prox.rodada;
      setThMediaSerie((arr) => [...arr, media]);
      return prox;
    });
  }

  function rodarNLote(n: number) { for (let i = 0; i < n; i++) rodarPasso(); }

  useEffect(() => {
    if (!autoplay) return;
    const id = setInterval(() => rodarPasso(), 120);
    return () => clearInterval(id);
  }, [autoplay, params]);

  const buffers = (estado.visAntes?.slice(1) || []) || [];
  const producao = estado.producao;
  const dados = estado.dados;

  function exportarCSV() {
    const headers = [
      "rodada","d1","d2","d3","d4","d5","d6","x1","x2","x3","x4","x5","x6","b2_ini","b3_ini","b4_ini","b5_ini","b6_ini","th","wip","lead","ganho","inv","do","lucro"
    ];
    const linhas = [headers.join(",")];
    linhas.push([
      estado.rodada,
      ...dados,
      ...producao,
      ...(estado.visAntes?.slice(1) || []),
      estado.th,
      estado.wip,
      estado.leadTime.toFixed(4),
      estado.ganho.toFixed(2),
      estado.inv.toFixed(2),
      estado.do.toFixed(2),
      estado.lucro.toFixed(2),
    ].join(","));
    const blob = new Blob([linhas.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `simulador-estado-r${estado.rodada}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const restricaoIndex = params.politica.gargalo - 1;

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 p-4">
        {/* Sidebar de parâmetros */}
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
                onChange={(e) => aplicarParametrosSoft({ politica: { ...params.politica, modo: e.target.value as any } })}>
                <option value="livre">Livre (push)</option>
                <option value="restricao">Subordinar à restrição (DBR)</option>
              </select>
              <label className="text-sm">Gargalo:</label>
              <select className="border rounded px-2 py-1" value={params.politica.gargalo}
                onChange={(e) => aplicarParametrosSoft({ politica: { ...params.politica, gargalo: parseInt(e.target.value, 10) as 1|2|3|4|5|6 } })}>
                {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{`M${n}`}</option>)}
              </select>
            </div>
            <NumberInput label="Buffer-alvo (dias)" value={params.politica.bufferAlvoDias ?? 0} step={0.5}
              onChange={(x) => aplicarParametrosSoft({ politica: { ...params.politica, bufferAlvoDias: x, bufferAlvoPecas: undefined } })} />
            <NumberInput label="Buffer-alvo (peças)" value={params.politica.bufferAlvoPecas ?? 0} step={1}
              onChange={(x) => aplicarParametrosSoft({ politica: { ...params.politica, bufferAlvoPecas: Math.max(0, Math.floor(x)) } })} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-600">Lead time – método</div>
            <div className="flex items-center gap-2">
              <select className="border rounded px-2 py-1" value={params.ltMetodo ?? 1}
                onChange={(e) => aplicarParametros({ ltMetodo: parseInt(e.target.value, 10) as 1|2|3|4 })}>
                <option value={1}>1) Little (WIP/TH médio)</option>
                <option value={2}>2) Estágios (Σ fila/μ + 1/μ + transf)</option>
                <option value={3}>3) Janela min–max (média)</option>
                <option value={4}>4) Monte Carlo</option>
              </select>
            </div>
            <NumberInput label="Atraso entre estágios (rodadas)" value={params.ltTransfer ?? 1} step={1}
              onChange={(x) => aplicarParametros({ ltTransfer: Math.max(0, Math.floor(x)) })} />
            { (params.ltMetodo ?? 1) === 4 && (
              <NumberInput label="Simulações Monte Carlo" value={params.ltMcRuns ?? 200} step={50}
                onChange={(x) => aplicarParametros({ ltMcRuns: Math.max(10, Math.floor(x)) })} />
            )}
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-600">Economia</div>
            <NumberInput label="Preço de venda (p)" value={params.preco} step={0.5}
              onChange={(x) => aplicarParametros({ preco: x })} />
            <NumberInput label="Custo variável (cv)" value={params.custoVariavel} step={0.5}
              onChange={(x) => aplicarParametros({ custoVariavel: x })} />
            <NumberInput label="Custo fixo por rodada (cf)" value={params.custoFixo} step={0.5}
              onChange={(x) => aplicarParametros({ custoFixo: x })} />
            <NumberInput label="Custo de inventário (h)" value={params.custoInventario} step={0.1}
              onChange={(x) => aplicarParametros({ custoInventario: x })} />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-600">Outros</div>
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
              <button onClick={() => { setEstado(estadoInicial(params)); setThMediaSerie([]); setAutoplay(false); }} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm">Recomeçar</button>
              <button onClick={exportarCSV} className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm">Exportar CSV</button>
            </div>
          </div>

          {/* Métricas de topo */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
            <Metric label="Rodada" value={estado.rodada} />
            <Metric label={`Lead time (método ${params.ltMetodo ?? 1})`} value={estado.leadTime} precision={2} />
            <Metric label="TH médio" value={estado.rodada ? estado.thAcum/estado.rodada : 0} precision={3} />
            <Metric label="WIP" value={estado.wip} />
            <Metric label="Ganho (R$)" value={estado.ganho} precision={2} />
            <Metric label="Lucro (R$)" value={estado.lucro} precision={2} />
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
              <Cell value={Number.isFinite(estado.visAntes?.[0] as number) ? (estado.visAntes?.[0] as number) : Infinity} infinity={params.politica.modo !== "restricao"} />
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <Metric label="Produção média" value={estado.rodada ? estado.thAcum/estado.rodada : 0} precision={4} />
            <Metric label="Peças produzidas" value={estado.thAcum} precision={0} />
            <Metric label="Custo Inv. (R$)" value={estado.inv} precision={2} />
            <Metric label="D.O. (R$)" value={estado.do} precision={2} />
          </div>
        </main>
      </div>
    </div>
  );
}
// Expor globalmente para o bootstrap do index.html (e para debug no console)
window.App = App;

// Se preferir que o próprio arquivo faça o render, ative as duas linhas abaixo
// e comente o bloco "fallback" do index.html:

// const root = ReactDOM.createRoot(document.getElementById('root'));
// root.render(<App />);
// window.__APP_MOUNTED__ = true;
