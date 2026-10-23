/* Rolagem por voz: acompanha a leitura do roteiro pela transcrição parcial do reconhecimento de fala.
   Mesmo critério do app nativo (teleprompter-ios, VoiceMatcher.swift). Testes: node tests/voz.test.js */
(function (raiz) {
  "use strict";
  var JANELA = 40;      // quantas palavras à frente do ponto atual se procura a palavra falada
  var MAX_TRECHO = 4;   // quantas palavras seguidas, contando para trás, se comparam para confirmar o trecho

  /* palavras muito comuns: sozinhas, só avançam se forem a próxima esperada */
  var COMUNS = new Set([
    "a", "o", "as", "os", "e", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
    "um", "uma", "uns", "umas", "num", "numa", "ao", "aos", "que", "se", "por", "pelo", "pela",
    "para", "pra", "pro", "com", "sem", "nao", "ou", "mas", "como", "mais", "ja", "so", "ate",
    "eu", "voce", "ele", "ela", "eles", "elas", "me", "te", "lhe", "seu", "sua", "seus", "suas",
    "meu", "minha", "isso", "isto", "esse", "essa", "este", "esta", "nem", "tem", "foi", "ser",
    "sao", "ha"
  ]);

  /* minúsculas, sem acento, só letras e números */
  function tokenizar(s) {
    return String(s || "").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  /* mesma palavra; em palavras de 5 letras ou mais aceita até 2 letras a mais no fim (plural) */
  function mesma(a, b) {
    if (a === b) return true;
    var curta = a.length <= b.length ? a : b, longa = a.length <= b.length ? b : a;
    return curta.length >= 5 && longa.length - curta.length <= 2 && longa.indexOf(curta) === 0;
  }

  /* quanto mais longe da próxima palavra esperada, mais palavras seguidas precisam bater */
  function aceita(trecho, temConteudo, distancia) {
    if (distancia === 0) return true;
    if (distancia <= 3) return temConteudo || trecho >= 2;
    if (distancia <= 12) return temConteudo && trecho >= 2;
    return temConteudo && trecho >= 3;
  }

  function Leitura(tokens) {
    this.tokens = tokens.slice();
    this.cursor = 0;     // índice do próximo token esperado do roteiro
    this.usado = -1;     // última palavra falada que já moveu o cursor (ou que deve ser ignorada)
    this.contagem = 0;   // palavras da última transcrição recebida
  }

  /* nova sessão de reconhecimento: a transcrição recomeça do zero e o ponto do roteiro fica */
  Leitura.prototype.novaSessao = function () {
    this.usado = -1;
    this.contagem = 0;
  };

  /* leva o ponto do roteiro para o token i (voltar a frase, arrastar o texto, nova gravação)
     e ignora o que já foi falado nesta sessão */
  Leitura.prototype.posicionar = function (i) {
    this.cursor = Math.max(0, Math.min(this.tokens.length, i));
    this.usado = this.contagem - 1;
  };

  /* recebe a transcrição acumulada da sessão; cada palavra falada move o cursor no máximo uma vez */
  Leitura.prototype.atualizar = function (transcricao) {
    var falado = tokenizar(transcricao);
    this.contagem = falado.length;
    this.usado = Math.min(this.usado, falado.length - 1);   // o parcial pode ser revisto e encolher
    for (var i = this.usado + 1; i < falado.length; i++) {
      var p = this.melhor(falado, i);
      if (p !== null) { this.cursor = p + 1; this.usado = i; }
    }
  };

  /* posição no roteiro da palavra falado[i], ou null se não for seguro avançar.
     Entre os candidatos aceitos vence o trecho mais longo que bate; no empate, o mais próximo. */
  Leitura.prototype.melhor = function (falado, i) {
    var t = this.tokens, fim = Math.min(t.length, this.cursor + JANELA), melhor = null, melhorTrecho = 0;
    for (var p = this.cursor; p < fim; p++) {
      if (!mesma(falado[i], t[p])) continue;
      var trecho = 0, conteudo = false;
      while (trecho < MAX_TRECHO && trecho <= i && trecho <= p && mesma(falado[i - trecho], t[p - trecho])) {
        if (!COMUNS.has(t[p - trecho])) conteudo = true;
        trecho++;
      }
      if (!aceita(trecho, conteudo, p - this.cursor)) continue;
      if (trecho > melhorTrecho) { melhor = p; melhorTrecho = trecho; }
    }
    return melhor;
  };

  var api = { tokenizar: tokenizar, Leitura: Leitura };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.Voz = api;
})(typeof window !== "undefined" ? window : this);
