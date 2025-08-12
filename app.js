// app.js — versão sem JSX (não precisa de Babel)
const { useState } = React;

function App() {
  const [rodada, setRodada] = useState(1);
  const [ganhoAcum, setGanhoAcum] = useState(0);
  const [doAcum, setDoAcum] = useState(0);
  const [invMaintAcum, setInvMaintAcum] = useState(0);
  const [invTOCAcum, setInvTOCAcum] = useState(0);
  const [lucroTOC, setLucroTOC] = useState(0);
  const [roiTOC, setROITOC] = useState(0);

  const precoVenda = 4;
  const custoFixo = 0.5;
  const custoInv = 0.3;

  const rodarSimulacao = () => {
    const producaoRodada = Math.floor(Math.random() * 6) + 1;

    const ganhoRodada = producaoRodada * precoVenda;
    const doRodada = custoFixo;
    const invMaintRodada = producaoRodada * custoInv;
    const invTOCRodada = producaoRodada * precoVenda; // proxy simplificado

    const novoGanhoAcum = ganhoAcum + ganhoRodada;
    const novoDoAcum = doAcum + doRodada;
    const novoInvMaintAcum = invMaintAcum + invMaintRodada;
    const novoInvTOCAcum = invTOCAcum + invTOCRodada;

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

  return React.createElement(
    "div",
    { style: { fontFamily: "Arial", padding: "20px" } },
    React.createElement("h1", null, "Fábrica (Jogo dos Dados)"),
    React.createElement("p", null, `Rodada: ${rodada}`),
    React.createElement("p", null, `Ganho (R$): ${ganhoAcum.toFixed(2)}`),
    React.createElement("p", null, `DO acumulada (R$): ${doAcum.toFixed(2)}`),
    React.createElement("p", null, `Custo de Manutenção Acumulado (R$): ${invMaintAcum.toFixed(2)}`),
    React.createElement("p", null, `Inventário TOC Acumulado (R$): ${invTOCAcum.toFixed(2)}`),
    React.createElement("p", null, `Lucro Operacional TOC (R$): ${lucroTOC.toFixed(2)}`),
    React.createElement("p", null, `ROI TOC: ${(roiTOC * 100).toFixed(2)}%`),
    React.createElement("button", { onClick: rodarSimulacao }, "Rodar 1")
  );
}

ReactDOM.render(
  React.createElement(App, null),
  document.getElementById("root")
);
