// Affiches Discord des ligues partenaires (WCNL et GTA), lancé avec les autres annonces
// (.github/workflows/annonce-course.yml). Pour chaque ligue dont le webhook est enregistré dans les secrets GitHub
// (DISCORD_WEBHOOK_WCNL, DISCORD_WEBHOOK_GTA) :
//   - podium de chaque manche dès qu'elle passe « Officiel » dans l'onglet Site du Sheet de la ligue ;
//   - top 3 du championnat après chaque manche officielle ;
//   - annonce de chaque nouvelle news de la ligue (articles du site marqués data-ligue) avec son lien.
// Les affiches sont rendues par le site (mcAffichePodium, mcAfficheClassement) puis photographiées.
// Au premier passage d'une ligue, tout ce qui existe déjà est noté sans rien poster.
// Courses test : jamais publiées automatiquement. Lancement à la main (input « affiches_tests ») pour publier
// une fois chacune les affiches des courses test d'une ligue, après validation des aperçus par Alexis.
import { chromium } from 'playwright';
import fs from 'node:fs';

const SITE = process.env.SITE_URL || 'https://meatball-mc.fr/';
const ETAT = process.argv[2] || 'ligues.json';
const TESTS = ['wcnl', 'gta'].includes(process.env.AFFICHES_TESTS) ? process.env.AFFICHES_TESTS : '';
const LIGUES = [
  { lg: 'wcnl', nom: 'WCNL', webhook: process.env.DISCORD_WEBHOOK_WCNL,
    csv: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTE32l-uN703CE_goz-p-3EDiVTf7qqoL9dLbtCFYagBPPvuDSP2aAhP8T8xL6nEYCxoYn3_U1Pwdoe/pub?gid=900100&single=true&output=csv' },
  { lg: 'gta', nom: 'GTA', webhook: process.env.DISCORD_WEBHOOK_GTA,
    csv: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR8tVpGFti6TRshf4TQP98JAz6koL5BGEPBgCia0qXzlVoYuYfHSs4IIUsfFKnIUwh-se3f7T-F7z32/pub?gid=900100&single=true&output=csv' },
];

function lireCsv(texte) {
  const lignes = []; let ligne = [], champ = '', guil = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guil) { if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') guil = false; else champ += c; }
    else if (c === '"') guil = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}
// mêmes blocs que le site (gtaBlocs) : titre en ligne 1, en-têtes en ligne 2
function blocs(rows) {
  const t = rows[0] || [], h = rows[1] || [], out = {};
  t.forEach((nom, i) => {
    nom = String(nom || '').trim(); if (!nom) return;
    let j = i; const cols = [];
    while (j < h.length && String(h[j] || '').trim()) { cols.push([String(h[j]).trim(), j]); j++; }
    out[nom] = rows.slice(2).map(r => Object.fromEntries(cols.map(([k, c]) => [k, String(r[c] || '').trim()]))).filter(o => Object.values(o).some(v => v));
  });
  return out;
}
const slug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const decoder = t => t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/\s+/g, ' ').trim();

// News d'une ligue : cartes d'article marquées data-ligue="<lg>" dans la page
function newsDuSite(html, lg) {
  return [...html.matchAll(/<div class="article-card"[^>]*data-ligue="([a-z]+)"[^>]*>[\s\S]*?class="article-title"[^>]*>([\s\S]*?)<\/div>/g)]
    .filter(m => m[1] === lg).map(m => decoder(m[2])).filter(Boolean).map(titre => ({ titre, id: slug(titre) }));
}

async function main() {
  const actives = LIGUES.filter(l => l.webhook);
  if (!actives.length) { console.log('Aucun webhook de ligue enregistré : aucune affiche.'); return; }
  let etat = {};
  try { etat = JSON.parse(fs.readFileSync(ETAT, 'utf8')); } catch (e) {}
  let html = '';
  try { html = await (await fetch(SITE + '?v=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } })).text(); } catch (e) {}

  const travail = []; // { l, type, cle, manche, test, texte }
  let change = false;
  for (const l of actives) {
    let b;
    try { b = blocs(lireCsv(await (await fetch(l.csv + '&v=' + Date.now())).text())); }
    catch (e) { console.log(`${l.nom} : lecture du Sheet impossible`, e.message); continue; }
    const cal = b.CALENDRIER || [], res = b.RESULTATS || [], tests = b['COURSES TEST'] || [];
    const officielles = cal.filter(c => c.Statut === 'Officiel' && res.some(r => r.Manche === c.Manche && r.Pilote));
    const items = [];
    officielles.forEach(c => items.push({ type: 'podium', cle: `podium|${c.Manche}|${c.Date}`, manche: c.Manche,
      texte: `🏁 **${l.nom} : résultats officiels de la manche ${c.Manche}**${c.Circuit ? `, ${c.Circuit.replace(/\s*\(.*\)\s*$/, '')}` : ''}\n<${SITE}#${l.lg}-stats>` }));
    const derniere = officielles[officielles.length - 1];
    if (derniere) items.push({ type: 'classement', cle: `classement|${derniere.Manche}|${derniere.Date}`,
      texte: `🏆 **${l.nom} : le top 3 du championnat après la manche ${derniere.Manche}**\n<${SITE}#${l.lg}-stats>` });
    newsDuSite(html, l.lg).forEach(n => items.push({ type: 'news', cle: `news|${n.id}`,
      texte: `📰 **Nouvelle news ${l.nom} : ${n.titre}**\n<${SITE}#${l.lg}-news>` }));
    const e = etat[l.lg];
    if (!e) {
      // premier passage : on note l'existant (y compris les courses test) sans rien poster
      etat[l.lg] = { vus: items.map(x => x.cle), tests: [] }; change = true;
      console.log(`${l.nom} : premier passage, ${items.length} élément(s) noté(s) sans annonce.`);
      continue;
    }
    items.filter(x => !e.vus.includes(x.cle)).forEach(x => travail.push({ l, ...x }));
    if (TESTS === l.lg) {
      [...new Set(tests.map(r => r.Manche))].filter(m => m && !(e.tests || []).includes(`${m}|${(tests.find(r => r.Manche === m) || {}).Date}`))
        .forEach(m => travail.push({ l, type: 'test', test: true, manche: m, cle: `${m}|${(tests.find(r => r.Manche === m) || {}).Date}`,
          texte: `🧪 **${l.nom} : podium de la course test ${m}**${(tests.find(r => r.Manche === m) || {}).Circuit ? `, ${(tests.find(r => r.Manche === m) || {}).Circuit.replace(/\s*\(.*\)\s*$/, '')}` : ''}` }));
    }
  }
  console.log(`${travail.length} affiche(s) ou annonce(s) de ligue à poster`);
  if (change && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'etat_change=1\n');
  if (change) fs.writeFileSync(ETAT, JSON.stringify(etat, null, 1) + '\n');
  if (!travail.length) return;
  if (process.env.VERIF_SEUL === '1') { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'a_faire=1\n'); return; }

  const poster = async (webhook, texte, image, fichier) => {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(image ? { content: texte, attachments: [{ id: 0, filename: fichier }] } : { content: texte }));
    if (image) form.append('files[0]', new Blob([image], { type: 'image/png' }), fichier);
    const r = await fetch(webhook, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`Discord a refusé l'annonce (${r.status}) : ${await r.text()}`);
    console.log('Posté :', texte.replace(/\n/g, ' '));
  };

  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(SITE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const ouverte = {};
  for (const t of travail) {
    const e = etat[t.l.lg];
    let image = null;
    if (t.type !== 'news') {
      if (!ouverte[t.l.lg]) {
        // ouvrir l'onglet de la ligue : charge ses données et ses couleurs
        await page.evaluate(lg => { const b = document.querySelector(`[data-tab="${lg}"]`); if (b) b.click(); }, t.l.lg);
        await page.waitForFunction(lg => lg === 'gta' ? (typeof GTA !== 'undefined' && GTA.ok) : (typeof WCNL !== 'undefined' && WCNL.ok), t.l.lg, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(1500); ouverte[t.l.lg] = true;
      }
      const ok = await page.evaluate(({ lg, type, manche, test }) => {
        const h = type === 'classement' ? mcAfficheClassement(lg) : mcAffichePodium(lg, manche, test);
        if (!h) return false;
        let x = document.getElementById('mcAfficheLigue');
        if (!x) { x = document.createElement('div'); x.id = 'mcAfficheLigue'; x.style.cssText = 'position:absolute;left:0;top:0;z-index:99999'; document.body.prepend(x); }
        x.innerHTML = h; return true;
      }, { lg: t.l.lg, type: t.type, manche: t.manche, test: !!t.test });
      if (!ok) { console.log('Affiche impossible (moins de 3 pilotes ?) :', t.cle); if (!t.test) e.vus.push(t.cle); continue; }
      await page.waitForFunction(() => [...document.querySelectorAll('#mcAfficheLigue img')].every(i => i.complete), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      image = await page.locator('#mcAfficheLigue .mc-aff').screenshot();
    }
    await poster(t.l.webhook, t.texte, image, `${t.l.lg}-${t.type}.png`);
    if (t.test) (e.tests = e.tests || []).push(t.cle); else e.vus.push(t.cle);
    fs.writeFileSync(ETAT, JSON.stringify(etat, null, 1) + '\n');
  }
  await navigateur.close();
}

main().catch(e => { console.error(e); process.exit(1); });
