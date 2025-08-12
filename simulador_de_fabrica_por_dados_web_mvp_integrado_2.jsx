
// Simulador de Fábrica (Jogo dos Dados) com métricas TOC adicionais

const { useState } = React;

function App() {
  const [rodada, setRodada] = useState(1);
  const [ganhoAcum, setGanhoAcum] = useState(0); // Ganho acumulado (Throughput TOC)
  const [doAcum, setDoAcum] = useState(0);       // Despesa Operacional acumulada
  const [invMaintAcum, setInvMaintAcum] = useState(0); // Custo de manutenção acumulado
  const [invTOCAcum, setInvTOCAcum] = useState(0);     // Inventário TOC acumulado
  const [lucroTOC, setLucroTOC] = useState(0);         // Lucro operacional TOC
  const [roiTOC, setROITOC] = useState(0);             // ROI TOC

  const precoVenda = 4;
  const custoFixo = 0.5;
  const custoInv = 0.3;

  const rodarSimulacao = () => {
    // Exemplo simplificado de produção
    const producaoRodada = Math.floor(Math.random() * 6) + 1;

    const ganhoRodada = producaoRodada * precoVenda;
    const doRodada = custoFixo;
    const invMaintRodada = producaoRodada * custoInv;
    const invTOCRodada = producaoRodada * precoVenda; // Proxy simplificado para capital investido

    // Atualiza acumulados
    const novoGanhoAcum = ganhoAcum + ganhoRodada;
    const novoDoAcum = doAcum + doRodada;
    const novoInvMaintAcum = invMaintAcum + invMaintRodada;
    const novoInvTOCAcum = invTOCAcum + invTOCRodada;

    // Calcula lucro TOC e ROI
    const novoLucroTOC = novoGanhoAcum - novoDoAcum;
    const novoROITOC = novoInvTOCAcum > 0 ? novoLucroTOC / novoInvTOCAcum : 0;

    setRodada(rodada + 1);
    setGanhoAcum(novoGanhoAcum);
    setDoAcum(novoDoAcum);
    setInvMaintAcum(novoInvMaintAcum);
    setInvTOCAcum(novoInvTOCAcum);
    setLucroTOC(novoLucroTOC);
    setROITOC(novoROITOC);
  };

  return (
    <div style={{ fontFamily: "Arial", padding: "20px" }}>
      <h1>Fábrica (Jogo dos Dados)</h1>
      <p>Rodada: {rodada}</p>
      <p>Ganho (R$): {ganhoAcum.toFixed(2)}</p>
      <p>DO acumulada (R$): {doAcum.toFixed(2)}</p>
      <p>Custo de Manutenção Acumulado (R$): {invMaintAcum.toFixed(2)}</p>
      <p>Inventário TOC Acumulado (R$): {invTOCAcum.toFixed(2)}</p>
      <p>Lucro Operacional TOC (R$): {lucroTOC.toFixed(2)}</p>
      <p>ROI TOC: {(roiTOC * 100).toFixed(2)}%</p>
      <button onClick={rodarSimulacao}>Rodar 1</button>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById("root"));


