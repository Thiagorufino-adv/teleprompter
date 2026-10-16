/* Editor de vídeo no próprio celular (16/10/2026, pedido do Thiago: "editor de vídeos junto com o teleprompter, hospedado no GitHub").
   Gera o vídeo pronto no aparelho, sem passar pelo computador: cortes marcados, começo/fim mudos e pausas longas tirados,
   aproximações de câmera, legenda no visual RDG (estilo grande do Thiago, pílula do Jian, faixa do anúncio), "Dúvida comum" e capa.
   A legenda é o texto do roteiro no tempo em que o teleprompter o mostrou na faixa (registrado na gravação), acertado pelas
   pausas do áudio. Medidas e cores copiadas de identidade-reels\finaliza_rdg.py e estilo_grande.py (quadro 1080×1920).
   O vídeo é gerado em tempo real (tocando a tomada num canvas gravado pelo MediaRecorder): 1 minuto leva ~1 minuto. */
window.RDGVideo = (function () {
  "use strict";
  var W = 1080, H = 1920, FPS = 30, BITRATE = 12000000;
  var COR = { car: "#663723", pet: "#23262E", br: "#FFFFFF", barra: "#C88A5B", rotulo: "#E3C3A6" };
  var GRANDE = { em: 74, y: 1440, larg: 940, contorno: 9, sombra: 3, pop: 0.11 };
  var PILULA = { margemV: 385, larg: 860, folga: 20 };
  var ANCORA_Y = 0.32, ZOOMS = [1.0, 1.16, 1.06, 1.22], EMPURRA = 0.035, TOMADA_MIN = 0.8, TOMADA_FRASE = 3.5;
  var PAUSA_LONGA = 0.7, PAUSA_FICA = 0.3, FOLGA_INICIO = 0.15, CAUDA = 0.6;
  var ATRASO_MIN = -0.6, ATRASO_MAX = 1.5, JANELA_ENCAIXE = 0.6, CAPA_T = 1.5;
  /* Formatos de saída. Vertical serve para Reels, TikTok e YouTube Shorts (o mesmo arquivo); feed = post 4:5 do Instagram;
     youtube = vídeo horizontal, com a pessoa numa faixa vertical no meio e o próprio vídeo desfocado nas laterais.
     video = área onde a tomada é desenhada [x, y, w, h]; alvoY = altura do rosto na área; o resto = posições da legenda,
     da "Dúvida comum" e da capa (o vertical é o do finaliza_rdg.py). */
  var FORMATOS = {
    vertical: { nome: "vertical", w: 1080, h: 1920, video: [0, 0, 1080, 1920], alvoY: ANCORA_Y, grandeY: 1440, pilBase: 1535, duvida: [60, 150, 960], capa: [70, 200, 940],
      nota: "Reels, TikTok e YouTube Shorts: o mesmo arquivo serve para os três." },
    feed: { nome: "feed", w: 1080, h: 1350, video: [0, 0, 1080, 1350], alvoY: 0.36, grandeY: 1030, pilBase: 1085, duvida: [60, 60, 960], capa: [70, 80, 940],
      nota: "Post no feed do Instagram (4:5)." },
    youtube: { nome: "youtube", w: 1920, h: 1080, video: [656, 0, 608, 1080], alvoY: ANCORA_Y, fundo: true, grandeY: 860, pilBase: 950, duvida: [460, 40, 1000], capa: [440, 80, 1040],
      nota: "Vídeo normal do YouTube (horizontal): a pessoa no meio e o fundo desfocado nas laterais." }
  };
  var Z_PADRAO = 1.08, Z_MAX = 1.6, Z_PASSO = 1.05;   // zoom sem padrão salvo (folga para centralizar), teto e passo do ajuste

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function fmtD(s) {
    s = Math.max(0, s || 0);
    var m = Math.floor(s / 60), r = Math.floor((s - m * 60) * 10) / 10;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1).replace(".", ",");
  }
  function norm(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function fimDeFrase(t) { return /[.?!…]["'”’»)\]]*$/.test(t); }
  function mediana(xs) { var s = xs.slice().sort(function (a, b) { return a - b; }); return s.length ? s[Math.floor(s.length / 2)] : null; }

  /* ---------- roteiro: as mesmas palavras, na mesma ordem, que o teleprompter mostra (index.html, montar) ---------- */
  function tokens(texto) {
    var out = [], frase = -1;
    String(texto || "").replace(/\r/g, "").split(/\n\s*\n/).map(function (p) { return p.replace(/\s+/g, " ").trim(); }).filter(Boolean).forEach(function (par) {
      var toks = par.split(" ");
      toks.forEach(function (tok, i) {
        var t = tok.replace(/\*/g, "");
        if (i === 0 || fimDeFrase(toks[i - 1].replace(/\*/g, ""))) frase += 1;
        out.push({ txt: t, emph: tok.indexOf("*") >= 0, frase: frase, peso: Math.max(1, norm(t).length) });
      });
    });
    return out;
  }

  /* ---------- áudio: volume a cada 20 ms e trechos com fala ---------- */
  function analisaAudio(blob) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    return blob.arrayBuffer().then(function (buf) {
      return new Promise(function (ok, erro) { ctx.decodeAudioData(buf, ok, erro); });   // forma com callback: Safari antigo não devolve promessa
    }).then(function (ab) {
      if (ctx.close) ctx.close();
      var passo = Math.round(ab.sampleRate * 0.02), canais = [], db = [];
      for (var c = 0; c < ab.numberOfChannels; c++) canais.push(ab.getChannelData(c));
      for (var i = 0; i + passo <= ab.length; i += passo) {
        var soma = 0;
        canais.forEach(function (d) { for (var k = i; k < i + passo; k++) soma += d[k] * d[k]; });
        db.push(10 * Math.log10(soma / (passo * canais.length) + 1e-12));
      }
      return { db: db, passo: 0.02, dur: ab.duration };
    }, function (e) { if (ctx.close) ctx.close(); throw e; });
  }
  function trechosDeFala(a) {
    if (!a.db.length) return [];
    var ord = a.db.slice().sort(function (x, y) { return x - y; });
    var piso = ord[Math.floor(ord.length * 0.1)], topo = ord[Math.floor(ord.length * 0.95)];
    var limite = Math.max(piso + 8, piso + (topo - piso) * 0.3);
    var reg = [], ini = -1;
    a.db.forEach(function (v, i) {
      if (v > limite && ini < 0) ini = i;
      if (v <= limite && ini >= 0) { reg.push([ini * a.passo, i * a.passo]); ini = -1; }
    });
    if (ini >= 0) reg.push([ini * a.passo, a.db.length * a.passo]);
    var juntos = [];   // buraco curto (consoante, respiro) não separa fala; estalo isolado não é fala
    reg.forEach(function (r) {
      var u = juntos[juntos.length - 1];
      if (u && r[0] - u[1] < 0.18) u[1] = r[1]; else juntos.push(r.slice());
    });
    return juntos.filter(function (r) { return r[1] - r[0] >= 0.08; });
  }
  function emFala(reg, t) { for (var i = 0; i < reg.length; i++) { if (t < reg[i][0]) return false; if (t <= reg[i][1]) return true; } return false; }

  /* ---------- cortes: os do celular + começo e fim mudos + pausas longas (se pedido) ---------- */
  function subtrai(manter, cortes) {
    var out = manter.map(function (s) { return s.slice(); });
    cortes.forEach(function (c) {
      var prox = [];
      out.forEach(function (s) {
        if (c[1] <= s[0] || c[0] >= s[1]) { prox.push(s); return; }
        if (c[0] > s[0]) prox.push([s[0], c[0]]);
        if (c[1] < s[1]) prox.push([c[1], s[1]]);
      });
      out = prox;
    });
    return out.filter(function (s) { return s[1] - s[0] > 0.05; });
  }
  /* Marca de corte feita no dedo cai no meio de palavra: o trecho mantido que começa (ou termina) dentro de uma fala
     vai para a borda da fala, incluindo a palavra inteira se faltava pouco, ou tirando o pedaço se sobrava pouco. */
  var ENCAIXE_INCLUI = 0.3, ENCAIXE_TIRA = 0.6;
  function encaixaNaFala(manter, reg, dur) {
    function dentro(t) { for (var i = 0; i < reg.length; i++) if (t > reg[i][0] && t < reg[i][1]) return reg[i]; return null; }
    return manter.map(function (s) {
      var a = s[0], b = s[1], r;
      if (a > 0.05 && (r = dentro(a))) a = a - r[0] <= ENCAIXE_INCLUI ? Math.max(0, r[0] - 0.05) : (r[1] - a <= ENCAIXE_TIRA ? r[1] : a);
      if (b < dur - 0.05 && (r = dentro(b))) b = r[1] - b <= ENCAIXE_INCLUI ? Math.min(dur, r[1] + 0.05) : (b - r[0] <= ENCAIXE_TIRA ? r[0] : b);
      return [a, b];
    }).filter(function (s) { return s[1] - s[0] > 0.05; });
  }
  function cortesDeSilencio(reg, dur, longas) {
    if (!reg.length) return [];
    var cortes = [[0, reg[0][0] - FOLGA_INICIO], [reg[reg.length - 1][1] + CAUDA, dur + 1]];
    if (longas) {
      for (var k = 0; k + 1 < reg.length; k++) {
        if (reg[k + 1][0] - reg[k][1] > PAUSA_LONGA) cortes.push([reg[k][1] + PAUSA_FICA / 2, reg[k + 1][0] - PAUSA_FICA / 2]);
      }
    }
    return cortes.filter(function (c) { return c[1] > c[0]; });
  }

  /* ---------- legenda: tempo de cada palavra no vídeo original ---------- */
  // leituras = trechos lidos em sequência; a volta da frase ou um arrasto começa outra leitura
  function leituras(log, n) {
    var runs = [], atual = null, ant = null;
    (log || []).forEach(function (e) {
      var t = e[0], i = e[1];
      if (!(i >= 0 && i < n)) return;
      if (!ant || i <= ant[1] || i > ant[1] + 4 || t - ant[0] > 6) { atual = []; runs.push(atual); }
      else for (var k = ant[1] + 1; k < i; k++) atual.push({ i: k, t: ant[0] + (t - ant[0]) * (k - ant[1]) / (i - ant[1]) });   // palavra pulada entre quadros
      atual.push({ i: i, t: t });
      ant = e;
    });
    return runs.filter(function (r) { return r.length; });
  }
  // atraso entre a palavra passar na faixa e ser falada: o que mais põe as palavras dentro da fala
  function estimaAtraso(runs, reg) {
    var melhor = 0.3, nota = -1;
    for (var d = ATRASO_MIN; d <= ATRASO_MAX + 1e-9; d += 0.05) {
      var n = 0;
      runs.forEach(function (r) { r.forEach(function (p) { if (emFala(reg, p.t + d + 0.1)) n += 1; }); });
      if (n > nota || (n === nota && Math.abs(d - 0.3) < Math.abs(melhor - 0.3))) { nota = n; melhor = d; }
    }
    return melhor;
  }
  function encaixa(x, lista) {
    var melhor = x, dist = JANELA_ENCAIXE;
    lista.forEach(function (v) { if (Math.abs(v - x) < dist) { dist = Math.abs(v - x); melhor = v; } });
    return melhor;
  }
  // reparte [s, e] entre as palavras pelo número de letras, contando só o tempo com fala (a pausa da vírgula fica fora)
  function distribui(itens, toks, s, e, reg) {
    var partes = [];
    reg.forEach(function (r) { var a = Math.max(r[0], s), b = Math.min(r[1], e); if (b > a) partes.push([a, b]); });
    var total = partes.reduce(function (x, p) { return x + p[1] - p[0]; }, 0);
    if (total < 0.15) { partes = [[s, e]]; total = e - s; }
    var pesos = itens.map(function (p) { return toks[p.i].peso; }), soma = pesos.reduce(function (x, y) { return x + y; }, 0);
    function tempo(frac) {
      var alvo = frac * total;
      for (var k = 0; k < partes.length; k++) {
        var len = partes[k][1] - partes[k][0];
        if (alvo <= len + 1e-9) return partes[k][0] + alvo;
        alvo -= len;
      }
      return partes[partes.length - 1][1];
    }
    var acc = 0;
    return itens.map(function (p, k) {
      var t0 = tempo(acc / soma);
      acc += pesos[k];
      return { i: p.i, t0: t0, t1: Math.max(t0 + 0.08, tempo(acc / soma)) };
    });
  }
  function alinha(runs, toks, reg) {
    var atraso = estimaAtraso(runs, reg), inicios = reg.map(function (r) { return r[0]; }), fins = reg.map(function (r) { return r[1]; });
    var palavras = [], fimAnt = 0;
    runs.forEach(function (run, r) {
      var porLetra = [];
      for (var k = 0; k + 1 < run.length; k++) porLetra.push((run[k + 1].t - run[k].t) / toks[run[k].i].peso);
      var ritmo = clamp(mediana(porLetra) || 0.075, 0.03, 0.2);
      var grupos = [], g = null;
      run.forEach(function (p) {
        if (!g || toks[p.i].frase !== toks[g[0].i].frase) { g = []; grupos.push(g); }
        g.push(p);
      });
      grupos.forEach(function (gr) {
        var ult = gr[gr.length - 1];
        var s = Math.max(fimAnt, encaixa(gr[0].t + atraso, inicios));
        var e = encaixa(ult.t + atraso + toks[ult.i].peso * ritmo, fins);
        if (e < s + 0.12 * gr.length) e = s + (ult.t - gr[0].t) + toks[ult.i].peso * ritmo;
        palavras = palavras.concat(distribui(gr, toks, s, e, reg).map(function (p) { p.r = r; return p; }));
        fimAnt = e;
      });
    });
    return palavras;
  }
  /* Repetição: quando a leitura seguinte recomeça numa palavra que esta leitura já tinha passado (o toque que volta a frase),
     o trecho desta leitura dali em diante foi abandonado: corta do começo dele até o recomeço. */
  function cortesDeRepeticao(runs, palavras, reg) {
    var inicios = reg.map(function (r) { return r[0]; }), cortes = [];
    for (var k = 0; k + 1 < runs.length; k++) {
      var volta = runs[k + 1][0].i;
      var abandonada = palavras.filter(function (p) { return p.r === k && p.i >= volta; })[0];
      var retomada = palavras.filter(function (p) { return p.r === k + 1; })[0];
      if (!abandonada || !retomada) continue;
      var a = encaixa(abandonada.t0, inicios) - 0.05, b = encaixa(retomada.t0, inicios) - 0.08;
      if (b - a > 0.2) cortes.push([a, b]);
    }
    return cortes;
  }
  // sem o registro do teleprompter (tomada antiga): reparte o roteiro inteiro pela fala que ficou no vídeo
  function semRegistro(toks, reg, manter) {
    if (!toks.length || !manter.length) return [];
    var falaMantida = [];
    reg.forEach(function (r) { manter.forEach(function (m) { var a = Math.max(r[0], m[0]), b = Math.min(r[1], m[1]); if (b > a) falaMantida.push([a, b]); }); });
    if (!falaMantida.length) falaMantida = manter;
    var itens = toks.map(function (t, i) { return { i: i }; });
    return distribui(itens, toks, falaMantida[0][0], falaMantida[falaMantida.length - 1][1], falaMantida);
  }
  // tempo do original -> tempo do vídeo pronto (palavra num trecho cortado sai da legenda). Na repartição sem registro
  // as palavras já estão só na fala mantida: vale o começo da palavra, para uma palavra que cruza o pulo não sumir.
  // Só sai da legenda a palavra que cai num corte de propósito (do celular ou da repetição). A que cai numa pausa tirada
  // (tempo estimado um pouco fora) fica, encostada na junção mais próxima: palavra faltando é pior que meio segundo de diferença.
  function paraSaida(palavras, manter, peloInicio, tirados) {
    var out = [];
    palavras.forEach(function (p) {
      var meio = peloInicio ? p.t0 + 0.01 : (p.t0 + p.t1) / 2, off = 0;
      for (var k = 0; k < manter.length; k++) {
        var a = manter[k][0], b = manter[k][1];
        if (meio >= a && meio < b) { out.push({ i: p.i, o0: off + Math.max(p.t0, a) - a, o1: off + Math.min(p.t1, b) - a }); return; }
        if (meio < a) break;
        off += b - a;
      }
      if ((tirados || []).some(function (c) { return meio >= c[0] && meio < c[1]; })) return;
      out.push({ i: p.i, o0: Math.max(0, off - 0.05), o1: off + 0.2 });
    });
    return out.sort(function (x, y) { return x.o0 - y.o0 || x.i - y.i; });
  }

  /* ---------- blocos de legenda (regras do estilo_grande.py e do reagrupa_srt.py) ---------- */
  var medidor = document.createElement("canvas").getContext("2d");
  function exibeGrande(t) { return t.replace(/[.,;:]+$/, "").toLocaleUpperCase("pt-BR"); }
  function blocosGrandes(pal, toks, dest) {
    medidor.font = "700 " + GRANDE.em + "px Poppins, sans-serif";
    var blocos = [], cur = [];
    pal.forEach(function (p) {
      if (cur.length) {
        var ant = cur[cur.length - 1], texto = cur.concat([p]).map(function (x) { return exibeGrande(toks[x.i].txt); }).join(" ");
        if (cur.length >= 3 || p.i !== ant.i + 1 || p.o0 - ant.o1 > 0.35 || /[.?!,;]$/.test(toks[ant.i].txt) || medidor.measureText(texto).width > GRANDE.larg) { blocos.push(cur); cur = []; }
      }
      cur.push(p);
    });
    if (cur.length) blocos.push(cur);
    return blocos.map(function (b, n) {
      var prox = blocos[n + 1], fim = b[b.length - 1].o1;
      fim = prox && prox[0].o0 - fim <= 0.45 ? prox[0].o0 : fim + 0.25;
      return { o0: b[0].o0, o1: Math.max(fim, b[0].o0 + 0.3), texto: b.map(function (x) { return exibeGrande(toks[x.i].txt); }).join(" "), dest: dest };
    });
  }
  function blocosPilula(pal, toks, dest, fonte) {
    var maxChars = Math.max(30, Math.round(52 * 52 / fonte)), blocos = [], cur = [];
    pal.forEach(function (p) {
      if (cur.length) {
        var ant = cur[cur.length - 1], texto = cur.concat([p]).map(function (x) { return toks[x.i].txt; }).join(" ");
        if (fimDeFrase(toks[ant.i].txt) || p.i !== ant.i + 1 || p.o0 - ant.o1 > 0.6) { blocos.push(cur); cur = []; }
        else if (texto.length > maxChars) {
          // passou do tamanho: quebra na última vírgula do bloco, se houver ("com o laudo e as / imagens" fica feio)
          var j = -1;
          cur.forEach(function (x, n) { if (/,$/.test(toks[x.i].txt) && n < cur.length - 1) j = n; });
          if (j >= 0) { blocos.push(cur.slice(0, j + 1)); cur = cur.slice(j + 1); } else { blocos.push(cur); cur = []; }
        }
      }
      cur.push(p);
    });
    if (cur.length) blocos.push(cur);
    return blocos.map(function (b, n) {
      var prox = blocos[n + 1], fim = b[b.length - 1].o1;
      fim = prox && prox[0].o0 - fim <= 0.45 ? prox[0].o0 : fim + 0.3;
      return { o0: b[0].o0, o1: Math.max(fim, b[0].o0 + 0.5), texto: b.map(function (x) { return toks[x.i].txt; }).join(" "), dest: dest };
    });
  }

  /* ---------- aproximações: troca de plano em cada junção de corte e, em fala longa, no começo da frase ---------- */
  function planoCamera(juncoes, frases, total) {
    var cand = juncoes.map(function (t) { return { t: t, forte: true }; }).concat(frases.map(function (t) { return { t: t, forte: false }; }))
      .sort(function (a, b) { return a.t - b.t; });
    var marcas = [0];
    cand.forEach(function (c) {
      var ult = marcas[marcas.length - 1];
      if (c.t - ult >= (c.forte ? TOMADA_MIN : TOMADA_FRASE) && total - c.t >= TOMADA_MIN) marcas.push(c.t);
    });
    return marcas.map(function (t, k) { return { ini: t, fim: k + 1 < marcas.length ? marcas[k + 1] : total, z: ZOOMS[k % ZOOMS.length] }; });
  }
  function zoomEm(cam, t) {
    for (var k = cam.length - 1; k >= 0; k--) {
      if (t >= cam[k].ini) return cam[k].z + EMPURRA * clamp((t - cam[k].ini) / Math.max(0.1, cam[k].fim - cam[k].ini), 0, 1);
    }
    return 1;
  }

  /* ---------- plano completo do vídeo ---------- */
  function montaPlano(take, op, manterCelular, audio) {
    var dur = audio.dur || take.dur, reg = trechosDeFala(audio);
    var marcado = encaixaNaFala(manterCelular.map(function (s) { return [Math.max(0, s[0]), Math.min(dur, s[1])]; }), reg, dur);
    var toks = tokens(take.roteiro && take.roteiro.texto);
    var runs = leituras(take.palavras, toks.length);
    var alinhadas = runs.length ? alinha(runs, toks, reg) : null;
    var cortes = cortesDeSilencio(reg, dur, op.fazer.pausas);
    var repeticoes = alinhadas && op.fazer.erros ? cortesDeRepeticao(runs, alinhadas, reg) : [];
    var manter = subtrai(marcado, cortes.concat(repeticoes)).filter(function (s) {
      return s[1] - s[0] > 0.25 || reg.some(function (r) { return r[0] < s[1] && r[1] > s[0]; });   // sobra de silêncio solta não fica
    });
    if (!manter.length) manter = manterCelular.slice();
    var fonte = alinhadas || semRegistro(toks, reg, manter);
    var tirados = subtrai([[0, dur]], marcado).concat(repeticoes);   // cortes de propósito (não as pausas)
    var pal = paraSaida(fonte, manter, !alinhadas, tirados);
    var dest = {};
    (op.destaques || []).forEach(function (d) { d.split(/\s+/).forEach(function (w) { if (norm(w)) dest[norm(w)] = true; }); });
    toks.forEach(function (t) { if (t.emph && norm(t.txt)) dest[norm(t.txt)] = true; });
    var estilo = op.destino === "anuncio" ? "faixa" : (op.quem === "jian" ? "pilula" : "grande");
    var blocos = !op.fazer.legenda ? [] : estilo === "grande" ? blocosGrandes(pal, toks, dest) : blocosPilula(pal, toks, dest, estilo === "faixa" ? 70 : 52);
    var total = manter.reduce(function (s, m) { return s + m[1] - m[0]; }, 0), juncoes = [], off = 0;
    manter.forEach(function (m, k) { if (k) juncoes.push(off); off += m[1] - m[0]; });
    var iniFrases = [], fraseAnt = -1;
    pal.forEach(function (p) { if (toks[p.i].frase !== fraseAnt) { fraseAnt = toks[p.i].frase; iniFrases.push(p.o0); } });
    return {
      manter: manter, total: total, estilo: estilo, blocos: blocos, palavras: pal.length, registro: runs.length > 0, repeticoes: repeticoes.length,
      cam: planoCamera(juncoes, iniFrases, total),   // só é usado com "Variar as tomadas" ligado
      duvida: estilo === "grande" ? op.duvida : "", titulo: op.titulo_capa || (take.roteiro ? take.roteiro.titulo : ""),
      capa: op.fazer.capa
    };
  }
  function saidaParaFonte(plano, to) {
    var off = 0;
    for (var k = 0; k < plano.manter.length; k++) {
      var m = plano.manter[k];
      if (to < off + m[1] - m[0]) return m[0] + to - off;
      off += m[1] - m[0];
    }
    var u = plano.manter[plano.manter.length - 1];
    return u ? u[1] - 0.05 : 0;
  }

  /* ---------- desenho do quadro ---------- */
  function retRedondo(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function quebra(c, texto, larg) {
    var linhas = [], cur = "";
    texto.split(/\s+/).filter(Boolean).forEach(function (p) {
      var t = cur ? cur + " " + p : p;
      if (c.measureText(t).width > larg && cur) { linhas.push(cur); cur = p; } else cur = t;
    });
    if (cur) linhas.push(cur);
    return linhas;
  }
  /* Enquadramento: a pessoa sai do mesmo tamanho e na mesma altura em todas as tomadas (pedido do Thiago, 16/10/2026).
     O rosto achado na tomada (r: centro e altura, em fração da fonte) e o padrão salvo (tamanho do rosto em fração da
     largura do quadro) dão o zoom; sem padrão, zoom fixo pequeno (para ter folga de centralizar). "Ajustar esta tomada"
     (S.manual) vale só para a tomada aberta. */
  function enquadre(F, vw, vh) {
    var R = F.video, rw = R[2], rh = R[3], sc = Math.max(rw / vw, rh / vh), r = S && S.rosto, p = S && S.padrao;
    var alvoY = F.nome !== "feed" && p && p.alvoY ? p.alvoY : F.alvoY;
    var e = { fx: r ? r.cx : 0.5, fy: r ? r.cy : alvoY, z: Z_PADRAO, alvoY: alvoY, sc: sc, rw: rw, rh: rh };
    if (r && p && p.rosto) e.z = clamp(p.rosto * rw / (r.h * vh * sc), 1, Z_MAX);
    if (S && S.manual) { e.fx = S.manual.fx; e.fy = S.manual.fy; e.z = S.manual.z; }
    return e;
  }
  var MINI_W = 32, MINI_H = 18, miniFundo = document.createElement("canvas");
  miniFundo.width = MINI_W; miniFundo.height = MINI_H;
  // laterais do 16:9: o próprio vídeo, muito desfocado (miniatura ampliada), escurecido e centrado na pessoa, para o rosto
  // borrado ficar atrás da faixa do meio e não aparecer grande num dos lados
  function desenhaFundo(c, v, F, fx, fy) {
    var m = miniFundo.getContext("2d"), vw = v.videoWidth || W, vh = v.videoHeight || H, s = Math.max(MINI_W / vw, MINI_H / vh);
    var dw = vw * s, dh = vh * s;
    m.drawImage(v, clamp(MINI_W / 2 - fx * dw, MINI_W - dw, 0), clamp(MINI_H / 2 - fy * dh, MINI_H - dh, 0), dw, dh);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
    c.drawImage(miniFundo, 0, 0, F.w, F.h);
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, 0, F.w, F.h);
  }
  function desenhaVideo(c, v, zTomada, F) {
    var vw = v.videoWidth || W, vh = v.videoHeight || H, e = enquadre(F, vw, vh), R = F.video;
    var s = e.sc * e.z * zTomada, dw = vw * s, dh = vh * s;
    var x = clamp(e.rw * 0.5 - e.fx * dw, e.rw - dw, 0), y = clamp(e.alvoY * e.rh - e.fy * dh, e.rh - dh, 0);
    if (F.fundo) desenhaFundo(c, v, F, e.fx, e.fy); else { c.fillStyle = "#000"; c.fillRect(0, 0, F.w, F.h); }
    c.save();
    c.beginPath(); c.rect(R[0], R[1], R[2], R[3]); c.clip();
    c.drawImage(v, R[0] + x, R[1] + y, dw, dh);
    c.restore();
    S.ultimo = { dw: dw, dh: dh, x: x, y: y, e: e, vw: vw, vh: vh };   // para arrastar e para "Usar como padrão"
  }
  function palavrasComDestaque(texto, dest) { return texto.split(/\s+/).filter(Boolean).map(function (w) { return { w: w, d: !!dest[norm(w)] }; }); }
  function desenhaGrande(c, b, t, F) {
    var itens = palavrasComDestaque(b.texto, b.dest), em = GRANDE.em;
    c.font = "700 " + em + "px Poppins, sans-serif";
    var larg = c.measureText(b.texto).width;
    if (larg > GRANDE.larg) { em = Math.floor(em * GRANDE.larg / larg); c.font = "700 " + em + "px Poppins, sans-serif"; larg = c.measureText(b.texto).width; }
    var esc = 0.88 + 0.12 * clamp((t - b.o0) / GRANDE.pop, 0, 1), esp = c.measureText(" ").width;
    c.save();
    c.translate(F.w / 2, F.grandeY); c.scale(esc, esc);
    c.textBaseline = "middle"; c.lineJoin = "round";
    [true, false].forEach(function (sombra) {
      var x = -larg / 2;
      itens.forEach(function (it) {
        var dx = sombra ? GRANDE.sombra : 0;
        c.lineWidth = GRANDE.contorno * 2;
        c.strokeStyle = sombra ? "rgba(0,0,0,0.5)" : (it.d ? COR.br : COR.pet);
        c.fillStyle = sombra ? "rgba(0,0,0,0.5)" : (it.d ? COR.car : COR.br);
        c.strokeText(it.w, x + dx, dx);
        c.fillText(it.w, x + dx, dx);
        x += c.measureText(it.w).width + esp;
      });
    });
    c.restore();
  }
  function desenhaPilula(c, b, fonte, F) {
    var em = fonte / 1.4, alt = fonte, f = PILULA.folga;   // no ASS o tamanho da fonte é a altura da linha (Poppins: 1,4 × o em)
    c.font = "700 " + em.toFixed(1) + "px Poppins, sans-serif";
    var linhas = quebra(c, b.texto, PILULA.larg).slice(0, 3), base = F.pilBase - f - alt * linhas.length, esp = c.measureText(" ").width;
    c.beginPath();
    linhas.forEach(function (ln, k) { var w = c.measureText(ln).width; c.rect((F.w - w) / 2 - f, base + k * alt - f, w + 2 * f, alt + 2 * f); });
    c.fillStyle = "rgba(255,255,255,0.92)"; c.fill("nonzero");
    c.textBaseline = "middle";
    linhas.forEach(function (ln, k) {
      var x = (F.w - c.measureText(ln).width) / 2, y = base + k * alt + alt / 2;
      palavrasComDestaque(ln, b.dest).forEach(function (it) {
        c.fillStyle = it.d ? COR.car : COR.pet;
        c.fillText(it.w, x, y);
        x += c.measureText(it.w).width + esp;
      });
    });
  }
  function desenhaDuvida(c, texto, F) {
    c.font = "600 36px Poppins, sans-serif";
    var x0 = F.duvida[0], y0 = F.duvida[1], larg = F.duvida[2];
    var linhas = quebra(c, texto, larg - 120), alt = 34 + 30 + linhas.length * 48 + 30;
    retRedondo(c, x0, y0, larg, alt, 24); c.fillStyle = "rgba(35,38,46,0.87)"; c.fill();
    retRedondo(c, x0, y0 + 20, 10, alt - 40, 5); c.fillStyle = COR.barra; c.fill();
    c.textBaseline = "top";
    c.font = "600 24px Poppins, sans-serif"; c.fillStyle = COR.rotulo;
    c.fillText(Array.from("DÚVIDA COMUM").join("  "), x0 + 44, y0 + 26);
    c.font = "600 36px Poppins, sans-serif"; c.fillStyle = COR.br;
    linhas.forEach(function (ln, k) { c.fillText(ln, x0 + 44, y0 + 66 + k * 48); });
  }
  function desenhaCaixinhaCapa(c, titulo, F) {
    c.font = "400 68px 'Playfair Display', Georgia, serif";
    var x0 = F.capa[0], y0 = F.capa[1], larg = F.capa[2];
    var linhas = quebra(c, titulo, larg - 80), lh = Math.floor(68 * 1.27), alt = 40 + linhas.length * lh + 40;
    retRedondo(c, x0, y0, larg, alt, 28); c.fillStyle = "rgba(255,255,255,0.95)"; c.fill();
    retRedondo(c, x0, y0, larg, 10, 5); c.fillStyle = COR.car; c.fill();
    c.textBaseline = "top"; c.fillStyle = COR.pet;
    linhas.forEach(function (ln, k) { c.fillText(ln, x0 + (larg - c.measureText(ln).width) / 2, y0 + 34 + k * lh); });
  }
  function blocoEm(blocos, t) {
    for (var k = 0; k < blocos.length; k++) { if (t >= blocos[k].o0 && t < blocos[k].o1) return blocos[k]; if (blocos[k].o0 > t) break; }
    return null;
  }
  function desenhaQuadro(c, v, plano, to, ajuste) {
    var F = FORMATOS[S.formato];
    desenhaVideo(c, v, S.variar ? zoomEm(plano.cam, to) : 1, F);   // sem "Variar as tomadas", o mesmo enquadramento o vídeo todo
    if (plano.duvida) desenhaDuvida(c, plano.duvida, F);
    var tl = to - ajuste, b = blocoEm(plano.blocos, tl);
    if (!b) return;
    if (plano.estilo === "grande") desenhaGrande(c, b, tl, F);
    else desenhaPilula(c, b, plano.estilo === "faixa" ? 70 : 52, F);
  }

  /* ---------- tela "Vídeo pronto" ---------- */
  var S = null;
  function status(msg) { $("gerStatus").textContent = msg; }
  function erro(msg) { var e = $("gerErro"); e.textContent = msg; e.hidden = !msg; }
  function botoes(fase) {
    var bv = $("gerVoltar");
    delete bv.dataset.ok; bv.textContent = "Voltar"; bv.classList.remove("perigo");
    $("gerGerar").hidden = fase !== "pronto";
    $("gerCancelar").hidden = fase !== "gerando";
    $("gerCompartilhar").hidden = fase !== "feito";
    $("gerArquivo").hidden = fase !== "feito";
    $("gerEnquadreBox").hidden = fase !== "pronto";
    if (fase !== "pronto") $("gerAjusteTomada").hidden = true;
    $("gerCapa").hidden = fase !== "feito" || !S || !S.capa;
    $("gerDeNovo").hidden = fase !== "feito";
    $("gerVoltar").hidden = fase === "gerando";
    $("gerAjuste").hidden = fase === "gerando" || !S || !S.plano || !S.plano.blocos.length;
    $("gerLegendas").hidden = $("gerAjuste").hidden;
    $("gerTela").hidden = fase === "feito";
    $("gerResultado").hidden = fase !== "feito";
    $("gerBarra").hidden = fase !== "gerando";
  }
  function irPara(v, t) {
    return new Promise(function (ok) {
      if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) { ok(); return; }
      var feito = false, fim = function () { if (!feito) { feito = true; ok(); } };
      v.addEventListener("seeked", fim, { once: true });
      setTimeout(fim, 2500);
      v.currentTime = t;
    });
  }
  function redesenha() {   // o quadro de amostra de novo, sem pular o vídeo (para arrastar, zoom, formato)
    if (S && S.plano) desenhaQuadro($("gerTela").getContext("2d"), S.video, S.plano, S.amostraT + 0.2, S.ajuste);
  }
  function desenhaAmostra() {
    if (!S || !S.plano) return Promise.resolve();
    var to = Math.min(CAPA_T, Math.max(0, S.plano.total - 0.1));
    S.amostraT = to;
    return irPara(S.video, saidaParaFonte(S.plano, to)).then(redesenha);
  }
  function geraCapa() {
    if (!S.plano.capa || !S.plano.titulo) return Promise.resolve(null);
    var to = Math.min(CAPA_T, Math.max(0, S.plano.total - 0.1)), F = FORMATOS[S.formato];
    return irPara(S.video, saidaParaFonte(S.plano, to)).then(function () {
      var cv = document.createElement("canvas"); cv.width = F.w; cv.height = F.h;
      var c = cv.getContext("2d");
      desenhaVideo(c, S.video, 1, F);
      c.fillStyle = "rgba(0,0,0,0.157)"; c.fillRect(0, 0, F.w, F.h);
      desenhaCaixinhaCapa(c, S.plano.titulo, F);
      return new Promise(function (ok) { cv.toBlob(ok, "image/jpeg", 0.92); });
    });
  }

  /* ---------- rosto: acha a pessoa para centralizar (MediaPipe Face Detector, baixado só na primeira vez, ~11 MB) ---------- */
  var MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
  var MODELO_ROSTO = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
  var AMOSTRAS_ROSTO = 5, ESPERA_ROSTO_MS = 45000, detector = null;
  function carregaDetector() {
    if (detector) return Promise.resolve(detector);
    return import(MP + "/vision_bundle.mjs").then(function (mp) {
      return mp.FilesetResolver.forVisionTasks(MP + "/wasm").then(function (arquivos) {
        return mp.FaceDetector.createFromOptions(arquivos, { baseOptions: { modelAssetPath: MODELO_ROSTO, delegate: "CPU" }, runningMode: "IMAGE", minDetectionConfidence: 0.5 });
      });
    }).then(function (d) { detector = d; return d; });
  }
  // rosto mediano em algumas amostras da parte que fica: centro e altura em fração da fonte (ou null)
  function achaRosto(v, plano) {
    var tela = document.createElement("canvas"), achados = [];
    var amostras = [];
    for (var i = 0; i < AMOSTRAS_ROSTO; i++) amostras.push(saidaParaFonte(plano, plano.total * (i + 0.5) / AMOSTRAS_ROSTO));
    return carregaDetector().then(function (d) {
      return amostras.reduce(function (p, t) {
        return p.then(function () { return irPara(v, t); }).then(function () {
          var vw = v.videoWidth, vh = v.videoHeight, s = 360 / vw;
          if (!vw) return;
          tela.width = 360; tela.height = Math.round(vh * s);
          tela.getContext("2d").drawImage(v, 0, 0, tela.width, tela.height);
          var r = d.detect(tela), maior = null;
          (r && r.detections || []).forEach(function (det) { var b = det.boundingBox; if (b && (!maior || b.width * b.height > maior.width * maior.height)) maior = b; });
          if (maior) achados.push({ cx: (maior.originX + maior.width / 2) / tela.width, cy: (maior.originY + maior.height / 2) / tela.height, h: maior.height / tela.height });
        });
      }, Promise.resolve());
    }).then(function () {
      if (!achados.length) return null;
      return { cx: mediana(achados.map(function (a) { return a.cx; })), cy: mediana(achados.map(function (a) { return a.cy; })), h: mediana(achados.map(function (a) { return a.h; })) };
    });
  }
  function comPrazo(p, ms) { return Promise.race([p, new Promise(function (ok, erro) { setTimeout(function () { erro(new Error("demorou demais")); }, ms); })]); }

  /* ---------- padrão de enquadramento (vale para todas as tomadas, guardado no aparelho) ---------- */
  function lePadrao() { try { return JSON.parse(localStorage.getItem("tpcam:enquadre") || "null"); } catch (e) { return null; } }
  function gravaPadrao(p) { try { localStorage.setItem("tpcam:enquadre", JSON.stringify(p)); } catch (e) { /* sem armazenamento */ } }
  // tamanho do rosto (fração da largura do quadro) e altura dele, como estão agora na amostra: vira o padrão das próximas
  function padraoDaAmostra() {
    var u = S.ultimo, r = S.rosto;
    if (!u || !r) return null;
    var alturaRosto = r.h * u.dh, centroY = u.y + r.cy * u.dh;
    return { rosto: alturaRosto / u.e.rw, alvoY: clamp(centroY / u.e.rh, 0.15, 0.6) };
  }
  function mostraEnquadre() {
    var F = FORMATOS[S.formato];
    document.querySelectorAll("#gerFormatos button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.formato === S.formato)); });
    $("gerFormatoNota").textContent = F.nota;
    $("gerVariar").setAttribute("aria-pressed", String(S.variar));
    $("gerAjustar").setAttribute("aria-pressed", String(!$("gerAjusteTomada").hidden));
    $("gerTela").classList.toggle("arrastando", !$("gerAjusteTomada").hidden);
    var z = S.ultimo ? S.ultimo.e.z : Z_PADRAO;
    $("gerZOut").textContent = "tamanho " + Math.round(z * 100) + "%";
    var t = $("gerTela");
    if (t.width !== F.w || t.height !== F.h) { t.width = F.w; t.height = F.h; }
    t.classList.toggle("deitada", F.w > F.h);
  }
  function mostraAjuste() {
    var a = S.ajuste;
    $("gerAjusteOut").textContent = "legenda " + (a > 0 ? "+" : a < 0 ? "−" : "") + Math.abs(a).toFixed(1).replace(".", ",") + " s";
  }
  function listaBlocos() {
    var ol = $("gerBlocos");
    ol.textContent = "";
    S.plano.blocos.forEach(function (b, k) {
      var li = document.createElement("li");
      var rot = document.createElement("label");
      rot.htmlFor = "gerBloco" + k;
      rot.textContent = fmtD(b.o0);
      var inp = document.createElement("input");
      inp.type = "text"; inp.id = "gerBloco" + k; inp.value = b.texto; inp.maxLength = 120; inp.autocomplete = "off";
      inp.addEventListener("input", function () { b.texto = inp.value.replace(/\s+/g, " ").trim() || b.texto; });
      inp.addEventListener("change", desenhaAmostra);
      li.append(rot, inp);
      ol.append(li);
    });
  }
  function nomeArquivo(take, ext, tipo) {
    var d = new Date(), p2 = function (n) { return String(n).padStart(2, "0"); };
    var base = take.nome.replace(/-tomada\d+\.\w+$/, "").replace(/^RDG-gravacao-/, "RDG-video-");
    return base + "-" + (tipo || "pronto") + "-" + S.formato + "-" + p2(d.getHours()) + p2(d.getMinutes()) + "." + ext;
  }

  /* ---------- zip sem compressão: o WhatsApp manda .zip como documento, sem baixar a resolução do vídeo ---------- */
  var TABELA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF, u = new Uint8Array(buf);
    for (var i = 0; i < u.length; i++) c = TABELA_CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(lista) {   // [{nome, blob}] -> Promise<Blob>; o conteúdo vai inteiro, sem recodificar
    return Promise.all(lista.map(function (a) { return a.blob.arrayBuffer(); })).then(function (bufs) {
      var partes = [], central = [], off = 0, cod = new TextEncoder(), d = new Date();
      var hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      var data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      lista.forEach(function (a, i) {
        var nome = cod.encode(a.nome), crc = crc32(bufs[i]), tam = bufs[i].byteLength;
        var lh = new DataView(new ArrayBuffer(30));
        [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, hora, 2], [12, data, 2], [14, crc, 4], [18, tam, 4], [22, tam, 4], [26, nome.length, 2], [28, 0, 2]]
          .forEach(function (c) { if (c[2] === 4) lh.setUint32(c[0], c[1], true); else lh.setUint16(c[0], c[1], true); });
        partes.push(lh.buffer, nome, a.blob);
        var ch = new DataView(new ArrayBuffer(46));
        [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, hora, 2], [14, data, 2], [16, crc, 4], [20, tam, 4], [24, tam, 4],
          [28, nome.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
          .forEach(function (c) { if (c[2] === 4) ch.setUint32(c[0], c[1], true); else ch.setUint16(c[0], c[1], true); });
        central.push(ch.buffer, nome);
        off += 30 + nome.length + tam;
      });
      var tamCentral = central.reduce(function (s, p) { return s + p.byteLength; }, 0);
      var fim = new DataView(new ArrayBuffer(22));
      [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, lista.length, 2], [10, lista.length, 2], [12, tamCentral, 4], [16, off, 4], [20, 0, 2]]
        .forEach(function (c) { if (c[2] === 4) fim.setUint32(c[0], c[1], true); else fim.setUint16(c[0], c[1], true); });
      return new Blob(partes.concat(central, [fim.buffer]), { type: "application/zip" });
    });
  }
  function formatoSaida() {
    if (!window.MediaRecorder) return null;
    var c = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) { /* segue */ } }
    return "";
  }
  // laço pelo quadro da tela (requestAnimationFrame): o requestVideoFrameCallback não dispara para o vídeo-fonte, que fica
  // invisível na página (o que aparece é o canvas). Cada trecho tem o seu laço, que se desliga quando o trecho acaba.
  function aCadaQuadro(fn) {
    var raf = function () { if (fn() !== false) requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  /* Toca cada trecho mantido e grava o canvas (imagem) + o som da própria tomada. O MediaRecorder fica pausado no pulo
     entre trechos e só volta quando o vídeo de fato andou (no iPhone o play demora um pouco depois do pulo); o fim do
     trecho é medido no relógio a partir daí, então nem essa demora nem um engasgo da tela cortam fala nem deixam entrar
     o som do trecho tirado. "execucao" identifica esta geração: um laço ou pulo de uma geração antiga não mexe na nova. */
  var ESPERA_MAX_MS = 8000;
  // pula um pouco ANTES do trecho e só volta a gravar quando o vídeo chega no ponto: o som recomeça com engasgo ou resto
  // do trecho anterior nos primeiros instantes depois do pulo, e esse pedaço fica fora da gravação
  var PRE_ROLAGEM = 0.3;
  function pontoDePulo(seg) { return Math.max(0, seg[0] - PRE_ROLAGEM); }
  var FOLGA_FECHAR_MS = 1500, AQUECIMENTO_MS = 1500;
  /* Esquenta o codificador de vídeo enquanto o áudio é analisado: a primeira gravação da página leva um tempo para
     começar a codificar e perdia quadros no começo do vídeo pronto. Grava 1,5 s de um canvas pequeno e joga fora. */
  function aqueceCodificador() {
    try {
      var mime = formatoSaida();
      if (!mime && mime !== "") return;
      var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      var c = cv.getContext("2d"), st = cv.captureStream(FPS), r = new MediaRecorder(st, mime ? { mimeType: mime, videoBitsPerSecond: BITRATE } : undefined);
      var fim = performance.now() + AQUECIMENTO_MS;
      (function pinta() { c.fillStyle = "hsl(" + Math.round(performance.now() / 10) % 360 + ",40%,40%)"; c.fillRect(0, 0, W, H); if (performance.now() < fim) requestAnimationFrame(pinta); })();
      r.start();
      setTimeout(function () { if (r.state !== "inactive") r.stop(); st.getTracks().forEach(function (t) { t.stop(); }); }, AQUECIMENTO_MS);
    } catch (e) { /* sem aquecimento: segue */ }
  }
  function renderizar(execucao) {
    return new Promise(function (ok, falha) {
      var v = S.video, segs = S.plano.manter, k = 0, off = 0, partes = [], tela = $("gerTela"), c = tela.getContext("2d");
      var mime = formatoSaida();
      if (mime === null || !tela.captureStream) { falha(new Error("Este navegador não grava o vídeo pronto. Use o Safari do iPhone.")); return; }
      var stream = tela.captureStream(FPS);
      S.destino.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
      var opts = { videoBitsPerSecond: BITRATE, audioBitsPerSecond: 192000 };
      if (mime) opts.mimeType = mime;
      var rec;
      try { rec = new MediaRecorder(stream, opts); } catch (e) { rec = new MediaRecorder(stream); }
      var pausa = typeof rec.pause === "function", relogio = null, ultimoDesenho = 0;
      S.rec = rec;
      function vivo() { return S && S.execucao === execucao && !S.cancelar; }
      var encerrado = false;
      function encerra() {
        if (encerrado) return;
        encerrado = true;
        clearTimeout(relogio);
        v.removeEventListener("ended", fimDoArquivo);
        stream.getVideoTracks().forEach(function (t) { t.stop(); });
        if (!vivo() || !partes.length) { falha(new Error("cancelado")); return; }
        ok(new Blob(partes, { type: (rec.mimeType || mime || "video/mp4") }));
      }
      // parar antes de a gravação começar (cancelou ou travou no 1º trecho) não gera o "stop": encerra direto
      function para() { clearTimeout(relogio); if (rec.state !== "inactive") rec.stop(); else encerra(); }
      S.paraGeracao = para;
      function fimDoArquivo() { proximo(k); }
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) partes.push(ev.data); };
      rec.onstop = encerra;
      // a gravação só começa quando o 1º trecho de fato anda (começar e pausar na hora deixava o início do vídeo congelado)
      function grava() {
        if (rec.state === "inactive") rec.start(1000);
        else if (pausa && rec.state === "paused") rec.resume();
      }
      function toca() {
        var p = v.play();
        if (p && p.catch) p.catch(function (e) {
          // AbortError = o play foi interrompido por um pause nosso (normal); só a recusa do aparelho para tudo
          if (e && e.name === "NotAllowedError" && vivo()) { S.semPermissao = true; S.cancelar = true; para(); }
        });
      }
      function comecaTrecho(de) {
        var t0 = v.currentTime, desde = performance.now(), andando = false;
        aCadaQuadro(function () {
          if (de !== k || k >= segs.length) return false;   // laço de um trecho que já acabou
          if (!vivo()) { para(); return false; }
          var seg = segs[k], t = v.currentTime;
          if (!andando) {
            if (t <= t0 + 0.02 || t < seg[0]) {   // ainda parado, ou ainda na pré-rolagem antes do trecho
              if (performance.now() - desde > ESPERA_MAX_MS) { S.travou = true; S.cancelar = true; para(); return false; }
              return true;
            }
            andando = true;
            grava();
            relogio = setTimeout(function () { proximo(de); }, Math.max(0, (seg[1] - t) * 1000 / (v.playbackRate || 1)));
          }
          var fim = t >= seg[1] - 0.5 / FPS || v.ended, agora = performance.now();
          if (fim || agora - ultimoDesenho >= 1000 / FPS - 4) {   // a tela do iPhone vai a 120 Hz; a gravação é de 30 quadros
            ultimoDesenho = agora;
            var to = off + Math.max(0, t - seg[0]);
            desenhaQuadro(c, v, S.plano, to, S.ajuste);
            $("gerBarraIn").style.width = (clamp(to / S.plano.total, 0, 1) * 100).toFixed(1) + "%";
            status("Gerando: " + fmtD(to) + " de " + fmtD(S.plano.total) + ". Não saia desta tela.");
          }
          if (fim) { proximo(de); return false; }
          return true;
        });
      }
      // "de" = trecho que pediu para avançar: o fim do arquivo, o relógio e o laço podem pedir ao mesmo tempo
      function proximo(de) {
        if (de !== k || k >= segs.length) return;
        clearTimeout(relogio);
        v.pause();
        if (pausa && rec.state === "recording") rec.pause();
        off += segs[k][1] - segs[k][0];
        k += 1;
        if (k >= segs.length && vivo() && pausa) {
          // acabou: gravação pausada (nada novo entra) e uma folga para o codificador terminar os quadros da fila antes de fechar
          // o arquivo; sem isso, num aparelho mais lento, o fim do vídeo saía sem imagem
          setTimeout(para, FOLGA_FECHAR_MS);
          return;
        }
        if (k >= segs.length || !vivo()) { para(); return; }
        var alvo = k;
        irPara(v, pontoDePulo(segs[alvo])).then(function () {
          if (!vivo() || alvo !== k) return;
          toca();
          comecaTrecho(alvo);
        });
      }
      v.addEventListener("ended", fimDoArquivo);
      comecaTrecho(0);
    });
  }
  function paraResultado() {   // o vídeo pronto que estiver tocando para e solta o arquivo
    var r = $("gerResultado");
    r.pause(); r.removeAttribute("src"); r.load();
  }
  var execucoes = 0;
  function gerar() {
    if (!S || !S.plano) return;
    if (!S.plano.manter.length || S.plano.total < 0.3) { erro("Não sobrou nada do vídeo depois dos cortes. Confira os cortes no editor da tomada."); return; }
    erro("");
    paraResultado();
    // dentro do toque: o iPhone só deixa tocar som e vídeo a partir de um gesto
    var AC = window.AudioContext || window.webkitAudioContext;
    try {
      if (!S.ac) S.ac = new AC();
      if (!S.destino) {   // createMediaElementSource só pode ser chamado uma vez por vídeo: na 2a geração reaproveita
        S.fonteAudio = S.ac.createMediaElementSource(S.video);
        S.destino = S.ac.createMediaStreamDestination();
        S.fonteAudio.connect(S.destino);
        S.fonteAudio.connect(S.ac.destination);   // dá para ouvir enquanto gera
      }
      if (S.ac.resume) S.ac.resume();
    } catch (e) { erro("Não deu para usar o som da tomada (" + (e.name || e) + ")."); return; }
    var minha = ++execucoes, sessao = S;
    S.execucao = minha; S.cancelar = false; S.saiuDaTela = false; S.semPermissao = false; S.travou = false; S.compartilhado = false;
    S.video.currentTime = pontoDePulo(S.plano.manter[0]);
    var p = S.video.play();
    if (p && p.catch) p.catch(function () { /* o laço do 1º trecho espera o vídeo andar e avisa se não andar */ });
    if ("wakeLock" in navigator) {
      navigator.wakeLock.request("screen").then(function (l) {
        if (S === sessao && S.execucao === minha && S.gerando) S.trava = l; else l.release().catch(function () {});
      }).catch(function () { /* tela pode apagar */ });
    }
    S.gerando = true;
    botoes("gerando");
    // sem padrão ainda: o enquadramento deste primeiro vídeo vira o padrão, e as próximas tomadas saem na mesma proporção
    var padraoNovo = !S.padrao && !S.manual ? padraoDaAmostra() : null;
    renderizar(minha).then(function (blob) {
      if (S !== sessao || S.execucao !== minha) return;
      if (S.resultadoUrl) URL.revokeObjectURL(S.resultadoUrl);
      S.resultado = blob;
      S.resultadoUrl = URL.createObjectURL(blob);
      $("gerResultado").src = S.resultadoUrl;
      var aviso = "";
      if (padraoNovo) { S.padrao = padraoNovo; gravaPadrao(padraoNovo); aviso = " Este enquadramento virou o padrão: as próximas tomadas saem na mesma proporção."; }
      status("Pronto: " + fmtD(S.plano.total) + " · " + (blob.size / 1048576).toFixed(1).replace(".", ",") + " MB. Assista antes de publicar." + aviso);
      return geraCapa().then(function (capa) { if (S === sessao) S.capa = capa; }, function () { /* sem capa */ }).then(function () {
        if (S !== sessao) return;
        botoes("feito");
        // o .zip (vídeo + capa) já fica montado: o compartilhar do iPhone só abre direto do toque, sem espera no meio
        var ext = /mp4/.test(blob.type) ? "mp4" : "webm", lista = [{ nome: nomeArquivo(S.take, ext), blob: blob }];
        if (S.capa) lista.push({ nome: nomeArquivo(S.take, "jpg", "capa"), blob: S.capa });
        S.zip = null;
        zip(lista).then(function (z) { if (S === sessao && S.resultado === blob) S.zip = z; }, function () { /* sem o .zip: o botão avisa */ });
      });
    }, function (e) {
      if (S !== sessao || S.execucao !== minha) return;
      var motivo = S.saiuDaTela ? "A geração parou porque a tela saiu do teleprompter (outro aplicativo ou tela bloqueada). Toque em Gerar vídeo de novo e deixe a tela aberta até o fim."
        : S.semPermissao ? "O iPhone não deixou tocar a tomada. Toque em Gerar vídeo de novo."
        : S.travou ? "A tomada travou ao tocar. Toque em Gerar vídeo de novo; se repetir, envie ao Claude."
        : S.cancelar ? "" : "Não deu para gerar: " + (e && e.message ? e.message : e);
      status(S.cancelar && !motivo ? "Cancelado." : "");
      erro(motivo);
      botoes("pronto");
    }).then(function () {
      if (S !== sessao) return;
      S.gerando = false;
      if (S.trava) { S.trava.release().catch(function () {}); S.trava = null; }
    });
  }
  function compartilhar(blob, nome, ehVideo) {
    var tipo = (blob.type || "video/mp4").split(";")[0], file = null, sessao = S;
    function guardado() { if (ehVideo && sessao) sessao.compartilhado = true; }   // vídeo já foi para algum lugar: Voltar não pede confirmação
    try { file = new File([blob], nome, { type: tipo }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).then(guardado).catch(function (e) {
        if (!e || e.name !== "AbortError") erro("O compartilhamento falhou. Tente de novo.");
      });
      return;
    }
    var a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    guardado();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  var aberturas = 0;
  function abrir(take, op, manterCelular) {
    fechar();
    var id = ++aberturas;
    var formato = "vertical";
    try { formato = FORMATOS[localStorage.getItem("tpcam:formato")] ? localStorage.getItem("tpcam:formato") : "vertical"; } catch (e) { /* padrão */ }
    S = { id: id, take: take, op: op, ajuste: 0, plano: null, capa: null, formato: formato, variar: !!op.fazer.aproximacoes,
          padrao: lePadrao(), rosto: take.rosto || null, manual: null, amostraT: 0 };
    var v = document.createElement("video");
    v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; v.className = "ger-fonte";
    v.src = take.url;
    $("painelGerar").append(v);
    S.video = v;
    $("gerTitulo").textContent = "Vídeo pronto · Tomada " + take.n;
    $("gerResultado").removeAttribute("src");
    erro(""); botoes("analisando");
    $("gerGerar").hidden = true;
    status("Analisando o áudio e montando a legenda…");
    $("painelGerar").hidden = false;
    var fontes = document.fonts ? Promise.all(["700 74px Poppins", "600 36px Poppins", "400 68px 'Playfair Display'"].map(function (f) {
      return document.fonts.load(f).catch(function () { return null; });
    })) : Promise.resolve();
    var meta = new Promise(function (ok) { if (v.readyState >= 1) ok(); else { v.addEventListener("loadedmetadata", ok, { once: true }); setTimeout(ok, 4000); } });
    aqueceCodificador();
    Promise.all([analisaAudio(take.blob), fontes, meta]).then(function (r) {
      if (!S || S.id !== id) return;   // a tela foi fechada ou reaberta enquanto analisava
      S.plano = montaPlano(take, op, manterCelular, r[0]);
      if (!S.plano.manter.length || S.plano.total < 0.3) {
        erro("Não sobrou nada do vídeo depois dos cortes. Confira os cortes no editor da tomada.");
        botoes("erro");
        return;
      }
      mostraAjuste();
      listaBlocos();
      var aviso = !op.fazer.legenda ? "Sem legenda (desmarcada no pedido)." :
        !S.plano.blocos.length ? "Não achei fala para legendar." :
        S.plano.registro ? "Legenda montada pelo tempo do teleprompter." : "Esta tomada não tem o registro do teleprompter: a legenda foi repartida pela fala. Confira com atenção.";
      var rep = S.plano.repeticoes ? " Tirei " + S.plano.repeticoes + (S.plano.repeticoes > 1 ? " repetições" : " repetição") + " onde você voltou a frase." : "";
      var resumo = "Vai ficar com " + fmtD(S.plano.total) + " (de " + fmtD(r[0].dur) + ")." + rep + " " + aviso;
      // acha o rosto uma vez por tomada (fica guardado nela); na primeira vez baixa o detector
      var rosto = take.rosto !== undefined ? Promise.resolve(take.rosto) : (function () {
        status((detector ? "Procurando o rosto para centralizar…" : "Procurando o rosto para centralizar (na primeira vez baixa o detector, uns 11 MB)…"));
        return comPrazo(achaRosto(v, S.plano), ESPERA_ROSTO_MS).then(function (rr) { take.rosto = rr; return rr; }, function () { return null; });
      })();
      return rosto.then(function (rr) {
        if (!S || S.id !== id) return;
        S.rosto = rr;
        S.avisoRosto = rr ? "" : " Não achei o rosto: o vídeo fica no meio. Use \"Ajustar esta tomada\" para mover.";
        status(resumo + S.avisoRosto);
        mostraEnquadre();
        return desenhaAmostra().then(function () { if (S && S.id === id) { mostraEnquadre(); botoes("pronto"); } });
      });
    }).catch(function (e) {
      if (!S || S.id !== id) return;
      erro("Não deu para analisar a tomada (" + (e && e.message ? e.message : e) + "). Tente gravar de novo ou envie ao Claude.");
      botoes("erro");
    });
  }
  function fechar() {
    if (!S) return;
    S.cancelar = true;
    if (S.gerando && S.paraGeracao) S.paraGeracao();
    if (S.trava) { S.trava.release().catch(function () {}); S.trava = null; }
    if (S.video) { S.video.pause(); S.video.removeAttribute("src"); S.video.load(); S.video.remove(); }
    if (S.ac && S.ac.close) S.ac.close().catch(function () {});
    paraResultado();
    if (S.resultadoUrl) URL.revokeObjectURL(S.resultadoUrl);
    S = null;
  }

  function liga() {
    $("gerGerar").addEventListener("click", gerar);
    $("gerDeNovo").addEventListener("click", function () {
      if (!S) return;
      paraResultado(); S.zip = null; botoes("pronto"); mostraEnquadre();
      desenhaAmostra(); status("Ajuste o que precisar (formato, enquadramento, legenda) e gere de novo.");
    });
    function cancela() {
      if (!S || !S.gerando) return;
      S.cancelar = true;
      S.video.pause();
      if (S.paraGeracao) S.paraGeracao();   // devolve "cancelado" e a tela volta ao estado de antes
    }
    $("gerCancelar").addEventListener("click", cancela);
    // com a tela fora do ar o desenho para e o vídeo sairia quebrado: melhor parar e avisar
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && S && S.gerando) { S.saiuDaTela = true; cancela(); }
    });
    $("gerCompartilhar").addEventListener("click", function () {
      if (S && S.resultado) compartilhar(S.resultado, nomeArquivo(S.take, /mp4/.test(S.resultado.type) ? "mp4" : "webm"), true);
    });
    $("gerCapa").addEventListener("click", function () { if (S && S.capa) compartilhar(S.capa, nomeArquivo(S.take, "jpg", "capa"), false); });
    $("gerArquivo").addEventListener("click", function () {
      if (!S || !S.resultado) return;
      if (!S.zip) { status("Ainda montando o arquivo. Toque de novo em alguns segundos."); return; }
      compartilhar(S.zip, nomeArquivo(S.take, "zip", "arquivo"), true);
    });

    /* formato, variar as tomadas e ajuste desta tomada */
    document.querySelectorAll("#gerFormatos button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!S || !S.plano) return;
        S.formato = b.dataset.formato;
        try { localStorage.setItem("tpcam:formato", S.formato); } catch (e) { /* lembra só nesta vez */ }
        mostraEnquadre(); redesenha(); mostraEnquadre();
      });
    });
    $("gerVariar").addEventListener("click", function () { if (!S) return; S.variar = !S.variar; mostraEnquadre(); redesenha(); });
    $("gerAjustar").addEventListener("click", function () {
      if (!S || !S.ultimo) return;
      var abre = $("gerAjusteTomada").hidden;
      $("gerAjusteTomada").hidden = !abre;
      if (abre && !S.manual) S.manual = { fx: S.ultimo.e.fx, fy: S.ultimo.e.fy, z: S.ultimo.e.z };
      mostraEnquadre();
    });
    function zoomManual(f) { if (!S || !S.manual) return; S.manual.z = clamp(S.manual.z * f, 1, Z_MAX); redesenha(); mostraEnquadre(); }
    $("gerZMenos").addEventListener("click", function () { zoomManual(1 / Z_PASSO); });
    $("gerZMais").addEventListener("click", function () { zoomManual(Z_PASSO); });
    $("gerPadraoSalvar").addEventListener("click", function () {
      if (!S) return;
      var p = padraoDaAmostra();
      if (!p) { status("Não achei o rosto nesta tomada: sem ele não dá para guardar o tamanho da pessoa como padrão."); return; }
      S.padrao = p; gravaPadrao(p);
      S.manual = null; $("gerAjusteTomada").hidden = true;
      redesenha(); mostraEnquadre();
      status("Padrão salvo: as próximas tomadas saem com a pessoa deste tamanho e nesta altura.");
    });
    $("gerPadraoVoltar").addEventListener("click", function () { if (!S) return; S.manual = null; $("gerAjusteTomada").hidden = true; redesenha(); mostraEnquadre(); });
    // com "Ajustar esta tomada" aberto, arrastar o vídeo move a pessoa no quadro
    var arraste = null, tela = $("gerTela");
    tela.addEventListener("pointerdown", function (e) {
      if (!S || !S.manual || $("gerAjusteTomada").hidden) return;
      arraste = { x: e.clientX, y: e.clientY };
      try { tela.setPointerCapture(e.pointerId); } catch (x) { /* sem captura: segue */ }
    });
    tela.addEventListener("pointermove", function (e) {
      if (!arraste || !S || !S.manual || !S.ultimo) return;
      var r = tela.getBoundingClientRect(), esc = tela.width / r.width;
      S.manual.fx = clamp(S.manual.fx - (e.clientX - arraste.x) * esc / S.ultimo.dw, 0, 1);
      S.manual.fy = clamp(S.manual.fy - (e.clientY - arraste.y) * esc / S.ultimo.dh, 0, 1);
      arraste = { x: e.clientX, y: e.clientY };
      redesenha();
    });
    ["pointerup", "pointercancel"].forEach(function (ev) { tela.addEventListener(ev, function () { arraste = null; }); });
    // vídeo gerado e ainda não compartilhado: o primeiro toque em Voltar só pergunta (a geração leva o tempo do vídeo)
    $("gerVoltar").addEventListener("click", function () {
      var b = $("gerVoltar");
      if (S && S.resultado && !S.compartilhado && !b.dataset.ok) {
        b.dataset.ok = "1"; b.textContent = "Descartar o vídeo?"; b.classList.add("perigo");
        return;
      }
      fechar();
      $("painelGerar").hidden = true;
    });
    $("gerMenos").addEventListener("click", function () { if (!S) return; S.ajuste = Math.round((S.ajuste - 0.1) * 10) / 10; mostraAjuste(); desenhaAmostra(); });
    $("gerMais").addEventListener("click", function () { if (!S) return; S.ajuste = Math.round((S.ajuste + 0.1) * 10) / 10; mostraAjuste(); desenhaAmostra(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", liga); else liga();

  return {
    abrir: abrir,
    // para teste no computador (o celular não usa)
    _interno: { tokens: tokens, trechosDeFala: trechosDeFala, leituras: leituras, alinha: alinha, paraSaida: paraSaida, montaPlano: montaPlano, analisaAudio: analisaAudio, subtrai: subtrai }
  };
})();
