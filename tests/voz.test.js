/* Testes da rolagem por voz (voz.js). Rodar: node tests/voz.test.js */
"use strict";
var Voz = require("../voz.js");

var falhas = 0;
function confere(nome, obtido, esperado) {
  if (obtido === esperado) console.log("ok    " + nome);
  else { console.log("FALHA " + nome + ": cursor " + obtido + ", esperado " + esperado); falhas++; }
}
function nova(roteiro) { return new Voz.Leitura(Voz.tokenizar(roteiro)); }
/* simula o reconhecimento entregando a transcrição palavra a palavra, como os resultados parciais */
function lendo(roteiro, falado) {
  var l = nova(roteiro), parcial = [];
  falado.split(" ").forEach(function (p) { parcial.push(p); l.atualizar(parcial.join(" ")); });
  return l;
}

confere("leitura em ordem chega ao fim",
  lendo("O segurado do INSS tem direito ao benefício.", "o segurado do INSS tem direito ao benefício").cursor, 8);

var r = "Hoje vamos falar de aposentadoria. A aposentadoria de quem trabalhou de forma rural tem regras próprias de idade.";
confere("palavra comum repetida não pula", lendo(r, "hoje vamos falar de").cursor, 4);
confere("segue a leitura depois dela", lendo(r, "hoje vamos falar de aposentadoria a aposentadoria").cursor, 7);

confere("palavra repetida fica na mais próxima",
  lendo("O benefício foi negado e o benefício precisa ser revisto.", "o benefício").cursor, 2);

var l = nova("muito muito bom");
l.atualizar("muito"); l.atualizar("muito");
confere("mesma transcrição duas vezes não avança", l.cursor, 1);
l.atualizar("muito muito");
confere("a segunda repetição avança", l.cursor, 2);

l = nova("o pedido foi negado");
l.atualizar("o pedi"); l.atualizar("o pedido");
confere("parcial revisto é reconsiderado", l.cursor, 2);

confere("palavra que o reconhecimento perdeu",
  lendo("o pedido foi negado pelo INSS ontem", "o pedido negado pelo INSS").cursor, 6);

confere("acento e maiúscula", lendo("Previdência Social", "previdencia social").cursor, 2);
confere("plural", lendo("os benefícios", "os benefício").cursor, 2);

confere("número falado por extenso",
  lendo("o salário mínimo de R$ 1.518 em 2026 vale para todos",
    "o salário mínimo de mil quinhentos e dezoito reais em 2026 vale para todos").cursor, 12);

var longe = "um dois tres quatro cinco seis sete oito nove dez onze doze treze catorze quinze " +
  "dezesseis dezessete dezoito dezenove vinte o laudo pericial confirmou a incapacidade total";
confere("trecho de 3 palavras lá na frente pula", lendo(longe, "o laudo pericial").cursor, 23);
confere("palavra solta lá na frente não pula", lendo(longe, "incapacidade").cursor, 0);

l = nova("o pedido foi negado pelo INSS");
l.atualizar("o pedido foi"); l.novaSessao(); l.atualizar("negado pelo");
confere("nova sessão continua de onde parou", l.cursor, 5);

l = nova("o pedido foi negado");
l.atualizar("o pedido"); l.posicionar(0); l.atualizar("o pedido");
confere("recomeçar ignora o que já foi falado", l.cursor, 0);
l.atualizar("o pedido o");
confere("depois de recomeçar segue do início", l.cursor, 1);

l = nova("o pedido foi negado. O INSS errou na conta.");
l.atualizar("o pedido foi negado o inss");
l.posicionar(4);                       // tocou no texto: volta para "O INSS errou…"
l.atualizar("o pedido foi negado o inss o inss errou");
confere("voltar a frase e repetir", l.cursor, 7);

console.log(falhas === 0 ? "todos os testes passaram" : falhas + " teste(s) falharam");
process.exit(falhas === 0 ? 0 : 1);
