// ===== Version anglaise du site =====
// Le site est écrit en français. En anglais, chaque texte affiché est remplacé à l'écran à partir
// du dictionnaire #i18n-en (segments HTML entiers ou textes simples) et des règles ci-dessous
// pour les textes générés avec des données (dates, grades, numéros...). Le français reste la source.
(function () {
  const CLE = 'mc_lang';
  let lang = 'fr';
  try { lang = localStorage.getItem(CLE) === 'en' ? 'en' : 'fr'; } catch (e) {}
  window.MC_LANG = lang;

  const INLINE = /^(B|STRONG|EM|I|A|SPAN|BR|SMALL|SUP|SUB|CODE|U|MARK|ABBR|TIME|Q|S|WBR)$/;
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|SVG|TEXTAREA|CODE|PRE)$/;
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const norm = s => s.replace(/\s+/g, ' ').trim();
  let SEG = null, TXT = null;

  const MOIS = { janvier: 'January', 'février': 'February', mars: 'March', avril: 'April', mai: 'May', juin: 'June', juillet: 'July', 'août': 'August', septembre: 'September', octobre: 'October', novembre: 'November', 'décembre': 'December' };
  const JOURS = { Lundi: 'Monday', Mardi: 'Tuesday', Mercredi: 'Wednesday', Jeudi: 'Thursday', Vendredi: 'Friday', Samedi: 'Saturday', Dimanche: 'Sunday' };
  const MOTS = { 'Programme jeunes pilotes': 'Young drivers programme', Mercato: 'Transfer window', 'Officiel iRacing': 'Official iRacing' };
  const mot = s => MOTS[s] || (TXT && TXT[s]) || s;
  const pl = (n, un, plusieurs) => n + ' ' + (Number(String(n).replace(',', '.')) === 1 ? un : plusieurs);
  const de = (nom, chose) => nom + "'s " + chose; // « X de Pilote » → « Pilote's X »

  // Règles pour les textes dynamiques (après normalisation des espaces)
  const R = [
    [/^(\d{1,2}) (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) (\d{4})(, (.+))?$/,
      (m, j, mo, a, x, suite) => MOIS[mo] + ' ' + j + ', ' + a + (suite ? ', ' + mot(suite) : '')],
    [/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) (\d{1,2}) (\S+) (\d{4})$/, (m, jo, j, mo, a) => JOURS[jo] + ' ' + (MOIS[mo] || mo) + ' ' + j + ', ' + a],
    [/^Mis à jour (.+) à (.+)$/, (m, d, h) => 'Updated ' + d + ' at ' + h],
    [/^Course (\d+) sur (\d+)$/, (m, a, b) => 'Race ' + a + ' of ' + b],
    [/^(\d+) ventes?$/, (m, n) => pl(n, 'sale', 'sales')],
    [/^([\d.,]+) € \/ unité$/, (m, p) => p + ' € / unit'],
    [/^(\d+) victoires?$/, (m, n) => pl(n, 'win', 'wins')],
    [/^(\d+) podiums?$/, (m, n) => pl(n, 'podium', 'podiums')],
    [/^(\d+) courses?$/, (m, n) => pl(n, 'race', 'races')],
    [/^(\d+) ans? et (\d+) mois$/, (m, a, mo) => pl(a, 'year', 'years') + ' and ' + pl(mo, 'month', 'months')],
    [/^J-(\d+) jours?$/, (m, n) => 'D-' + n + ' ' + (n === '1' ? 'day' : 'days')],
    [/^jours?$/, m => (m === 'jour' ? 'day' : 'days')],
    [/^Départ P(\d+)$/, (m, n) => 'Started P' + n],
    [/^(.+) · Manche (\d+)\/(\d+)$/, (m, l, a, b) => tr1(l) + ' · Round ' + a + '/' + b],
    [/^(.+) · Manche (\d+)\/(\d+) ·$/, (m, l, a, b) => tr1(l) + ' · Round ' + a + '/' + b + ' ·'],
    [/^Pilotes : (.+)$/, (m, l) => 'Drivers: ' + l],
    [/^Division : (.+)$/, (m, d) => 'Division: ' + mot(d)],
    [/^Power Ranking : (\d+)e, (\d+) pts$/, (m, r, p) => 'Power Ranking: #' + r + ', ' + p + ' pts'],
    [/^P(\d+) à P(\d+)$/, (m, a, b) => 'P' + a + ' to P' + b],
    [/^Victoire de (.+?), (.+)$/, (m, n, l) => de(n, 'win') + ', ' + mot(l)],
    [/^Voiture de (.+)$/, (m, n) => de(n, 'car')],
    [/^(.+?) n°(\d+) de (.+)$/, (m, v, num, n) => de(n, v + ' #' + num)],
    [/^(.+) - vue (\d+)$/, (m, p, n) => tr1(p) + ' - view ' + n],
    [/^(.+) - capture d'écran (\d+)$/, (m, p, n) => tr1(p) + ' - screenshot ' + n],
    [/^(.+) · (.+)$/, (m, a, b) => { const x = tr1(a), y = tr1(b); return (x !== a || y !== b) ? x + ' · ' + y : null; }],
    [/^⏳ ATTENTE : (.+)$/, (m, s) => '⏳ WAITING: ' + attente(s)],
    [/^🔔 PROMOTION : (.+)$/, (m, g) => '🔔 PROMOTION: ' + grade(g)],
    [/^🏆 ELITE DU CLUB : (.+)$/, (m, s) => '🏆 CLUB ELITE: ' + (s === 'DIVISION 1 VALIDÉE' ? 'DIVISION 1 CONFIRMED' : mot(s))],
    [/^(\d+),(\d+)$/, (m, a, b) => a + '.' + b],
    [/^(\d+(?:,\d+)?) €$/, (m, p) => p.replace(',', '.') + ' €'],
  ];
  function grade(g) {
    return g.replace(/Vice-Président|VICE-PRÉSIDENT/g, m => m === m.toUpperCase() ? 'VICE PRESIDENT' : 'Vice President')
            .replace(/Président|PRÉSIDENT/g, m => m === m.toUpperCase() ? 'PRESIDENT' : 'President')
            .replace(/\bSERGEANT\b(?! AT ARMS)/, 'SERGEANT');
  }
  function attente(s) {
    return s.replace(/(\d+) Saisons? en D3/g, (m, n) => pl(n, 'Season', 'Seasons') + ' in D3')
      .replace(/(\d+) Courses?/g, (m, n) => pl(n, 'Race', 'Races'))
      .replace(/(\d+) Briefings?/g, (m, n) => pl(n, 'Briefing', 'Briefings'))
      .replace(/(\d+) Victoires? ou Division (\d)/g, (m, n, d) => pl(n, 'Win', 'Wins') + ' or Division ' + d)
      .replace('Atteindre la Division', 'Reach Division')
      .replace(/Top 5 ou Div/g, 'Top 5 or Div');
  }
  // Traduction d'un texte normalisé (null si rien à changer)
  function tr1(n) {
    if (TXT[n] != null) return TXT[n];
    for (const [re, f] of R) {
      const m = n.match(re);
      if (m) { const r = f(...m); if (r != null) return r; }
    }
    return n;
  }
  function trTexte(s) {
    const n = norm(s);
    if (!n || !(/[A-Za-zÀ-ÿ]/.test(n) || /^\d+,\d+( €)?$/.test(n))) return null;
    const r = tr1(n);
    if (r === n) return null;
    return s.match(/^\s*/)[0] + r + s.match(/\s*$/)[0];
  }
  function inlineOnly(el) { for (const d of el.querySelectorAll('*')) if (!INLINE.test(d.tagName)) return false; return true; }
  function attrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const t = trTexte(v); if (t != null) el.setAttribute(a, t); }
    }
  }
  function traduire(el) {
    if (!el || el.nodeType !== 1 || SKIP.test(el.tagName) || el.closest('[data-i18n-skip]')) return;
    if (el.children.length && inlineOnly(el)) {
      const k = norm(el.innerHTML);
      if (SEG[k] != null) { el.innerHTML = SEG[k]; attrs(el); return; }
    }
    attrs(el);
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { const t = trTexte(n.nodeValue); if (t != null) n.nodeValue = t; }
      else if (n.nodeType === 1) traduire(n);
    }
  }
  let obs = null, attente_ = new Set(), prevu = false;
  function appliquer() {
    prevu = false;
    obs.disconnect();
    for (const n of attente_) {
      if (!n.isConnected) continue;
      if (n.nodeType === 3) { const t = trTexte(n.nodeValue); if (t != null) n.nodeValue = t; }
      else traduire(n.parentElement && n.parentElement.children.length && inlineOnly(n.parentElement) ? n.parentElement : n);
    }
    attente_.clear();
    observer();
  }
  function observer() {
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function demarrer() {
    if (!SEG) { const j = JSON.parse(document.getElementById('i18n-en').textContent); SEG = j.seg; TXT = j.txt; }
    document.documentElement.lang = 'en';
    document.title = 'Meatball MC — Team Dashboard';
    traduire(document.body);
    obs = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') attente_.add(m.target);
        else if (m.type === 'attributes') attente_.add(m.target);
        else m.addedNodes.forEach(n => attente_.add(n));
      }
      if (!prevu) { prevu = true; Promise.resolve().then(appliquer); }
    });
    observer();
  }
  window.mcSetLang = function (l) {
    try { localStorage.setItem(CLE, l); } catch (e) {}
    if (l === 'fr') { location.reload(); return; }
    window.MC_LANG = 'en';
    demarrer();
    majBouton();
  };
  function majBouton() {
    const b = document.getElementById('langBtn');
    if (!b) return;
    // Le drapeau montre la langue affichée ; un clic passe à l'autre langue
    const enFrancais = window.MC_LANG !== 'en';
    b.innerHTML = enFrancais ? DRAPEAU_FR + '<span>FR</span>' : DRAPEAU_GB + '<span>EN</span>';
    b.setAttribute('aria-label', enFrancais ? 'Langue : français. Switch to English' : 'Language: English. Passer en français');
    b.setAttribute('title', enFrancais ? 'Switch to English' : 'Passer en français');
  }
  const DRAPEAU_GB = '<svg viewBox="0 0 60 30" width="30" height="15" aria-hidden="true"><clipPath id="gbc"><path d="M0,0 v30 h60 v-30 z"/></clipPath><clipPath id="gbt"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><g clip-path="url(#gbc)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#gbt)" stroke="#C8102E" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></g></svg>';
  const DRAPEAU_FR = '<svg viewBox="0 0 3 2" width="22" height="15" aria-hidden="true"><path fill="#002654" d="M0 0h1v2H0z"/><path fill="#fff" d="M1 0h1v2H1z"/><path fill="#CE1126" d="M2 0h1v2H2z"/></svg>';
  document.addEventListener('DOMContentLoaded', () => {
    majBouton();
    if (lang === 'en') demarrer();
  });
})();
