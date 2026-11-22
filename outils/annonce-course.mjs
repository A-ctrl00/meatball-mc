// Annonces Discord automatiques : courses du soir et nouveaux articles du site.
// Lancé toutes les 15 minutes par GitHub (.github/workflows/annonce-course.yml).
// Pour chaque course du jour dans l'onglet CALENDRIER du Sheet :
//   - heure de départ renseignée (colonne G) : l'annonce part 4 heures avant ;
//   - pas d'heure : l'annonce part à 17h ;
// on photographie le cadre « Prochaine course » du site pour cette course et on le poste
// sur Discord par le webhook (secret GitHub DISCORD_WEBHOOK_COURSES). Une seule fois par course :
// les courses déjà annoncées sont notées dans le fichier passé en argument.
// Nouveaux articles : à chaque passage, on compare la liste des articles du site à celle déjà annoncée
// (fichier articles.json à côté) ; chaque nouvel article est posté avec la photo de son cadre et son lien.
// Au tout premier passage, les articles existants sont seulement notés, rien n'est posté.
// Résultats : dès qu'une soirée d'une ligue apparaît dans RESULTATS LIGUE (bot ou saisie), on poste le cadre
// « Résultats » du site (voiture, initiales, numéro, départ et arrivée de chaque pilote) ; fichier resultats.json.
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHEET = '1xyAVmXsdmOs_8q6jFZkJLd9prrofzAQJ_YlI-Ssf84E';
const GID_CALENDRIER = 494383415;
const GID_RESULTATS = 1015066806;
// On annonce une soirée de résultats dès qu'elle apparaît dans le Sheet, si la course date de moins de 21 jours :
// certaines ligues (IFRN) publient leurs résultats plusieurs jours après, mais une saisie d'anciennes courses
// (comme la SBG de l'été) ne doit rien reposter.
const JOURS_RESULTATS = 21;
const SITE = process.env.SITE_URL || 'https://meatball-mc.fr/';
const WEBHOOK = process.env.DISCORD_WEBHOOK_COURSES;
const ETAT = process.argv[2] || 'annonces.json';
const AVANCE_MIN = 4 * 60;      // 4 heures avant le départ
const HEURE_DEFAUT = '17:00';   // sans heure de départ
// essai (lancement à la main depuis GitHub) : 'course' poste la prochaine course même si ce n'est pas l'heure,
// 'resultats' poste le cadre de la dernière soirée enregistrée ; rien n'est noté comme déjà annoncé
const MODE_ESSAI = ['course', 'resultats'].includes(process.env.ESSAI) ? process.env.ESSAI : '';
const ESSAI = !!MODE_ESSAI;

// Heure de Paris, en minutes depuis minuit, et date du jour au format 2026-11-17
function maintenantParis() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { jour: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}

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
const iso = v => { const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const heure = v => { const m = String(v || '').trim().match(/^(\d{1,2})[:h](\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
const minutes = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };

// Identifiant d'un article : son titre simplifié (le même que le lien #article-… du site)
const slug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const ENTITES = { amp: '&', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à' };
const decoder = t => t.replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ').trim();

// Titres des articles du site, lus dans la page sans navigateur (rapide)
async function articlesDuSite() {
  const html = await (await fetch(SITE + '?v=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } })).text();
  const debut = html.indexOf('id="newsArticles"');
  const zone = debut >= 0 ? html.slice(debut) : html;
  return [...zone.matchAll(/class="article-title"[^>]*>([\s\S]*?)<\/div>/g)].map(m => decoder(m[1])).filter(Boolean)
    .map(titre => ({ titre, id: slug(titre) }));
}

async function main() {
  // tant que le webhook n'est pas enregistré dans les secrets GitHub, on ne fait rien (sans erreur)
  if (!WEBHOOK) { console.log('Secret DISCORD_WEBHOOK_COURSES absent : aucune annonce.'); return; }
  const ETAT_ARTICLES = ETAT.replace(/[^/]+$/, 'articles.json');

  // --- Courses du soir ---
  const csv = await (await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID_CALENDRIER}`)).text();
  const courses = lireCsv(csv).slice(1)
    .map(r => ({ date: iso(r[0]), ligue: (r[1] || '').trim(), nom: (r[2] || '').trim(), circuit: (r[3] || '').trim(), heure: heure(r[6]) }))
    .filter(c => c.date && c.ligue);
  const { jour, minutes: mtn } = maintenantParis();
  let etat = {};
  try { etat = JSON.parse(fs.readFileSync(ETAT, 'utf8')); } catch (e) {}

  let aPoster;
  if (ESSAI) {
    aPoster = MODE_ESSAI === 'course' ? courses.filter(c => c.date >= jour).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 1) : [];
  } else {
    aPoster = courses.filter(c => {
      if (c.date !== jour) return false;
      const id = `${c.date}|${c.ligue}|${c.nom}`;
      if (etat[id]) return false;
      const depart = c.heure ? minutes(c.heure) : null;
      const envoi = depart != null ? depart - AVANCE_MIN : minutes(HEURE_DEFAUT);
      const limite = depart != null ? depart : 23 * 60 + 59; // jamais après le départ
      return mtn >= envoi && mtn < limite;
    });
  }

  // --- Nouveaux articles ---
  let dejaVus = null;
  try { dejaVus = JSON.parse(fs.readFileSync(ETAT_ARTICLES, 'utf8')); } catch (e) {}
  let nouveaux = [];
  let listeSite = [];
  try { listeSite = await articlesDuSite(); } catch (e) { console.log('Lecture des articles impossible :', e.message); }
  if (listeSite.length && !ESSAI) {
    if (!Array.isArray(dejaVus)) {
      // tout premier passage : on note les articles existants sans rien poster
      fs.writeFileSync(ETAT_ARTICLES, JSON.stringify(listeSite.map(a => a.id), null, 1) + '\n');
      console.log(`${listeSite.length} articles existants notés (aucune annonce au premier passage).`);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'etat_change=1\n');
    } else {
      nouveaux = listeSite.filter(a => !dejaVus.includes(a.id));
    }
  }

  // --- Résultats des courses ---
  const ETAT_RESULTATS = ETAT.replace(/[^/]+$/, 'resultats.json');
  let resVus = null;
  try { resVus = JSON.parse(fs.readFileSync(ETAT_RESULTATS, 'utf8')); } catch (e) {}
  let soirees = [];
  try {
    const csvR = await (await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID_RESULTATS}`)).text();
    const vues = new Map();
    for (const r of lireCsv(csvR).slice(1)) {
      const d = (r[0] || '').trim(), l = (r[2] || '').trim();
      if (!iso(d) || !l || !(r[1] || '').trim()) continue;
      vues.set(`${d}|${l}`, { date: d, ligue: l, iso: iso(d) });
    }
    soirees = [...vues.values()];
  } catch (e) { console.log('Lecture des résultats impossible :', e.message); }
  let nouvellesSoirees = [];
  if (MODE_ESSAI === 'resultats') {
    nouvellesSoirees = soirees.sort((a, b) => a.iso.localeCompare(b.iso)).slice(-1);
  } else if (soirees.length && !ESSAI) {
    if (!Array.isArray(resVus)) {
      fs.writeFileSync(ETAT_RESULTATS, JSON.stringify(soirees.map(x => `${x.date}|${x.ligue}`), null, 1) + '\n');
      console.log(`${soirees.length} soirées de résultats existantes notées (aucune annonce au premier passage).`);
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'etat_change=1\n');
    } else {
      const depuis = new Date(Date.now() - JOURS_RESULTATS * 86400000).toISOString().slice(0, 10);
      nouvellesSoirees = soirees.filter(x => !resVus.includes(`${x.date}|${x.ligue}`) && x.iso >= depuis)
        .sort((a, b) => a.iso.localeCompare(b.iso));
    }
  }

  console.log(`${jour} ${Math.floor(mtn / 60)}h${String(mtn % 60).padStart(2, '0')} : ${aPoster.length} course(s), ${nouveaux.length} article(s) et ${nouvellesSoirees.length} résultat(s) à annoncer`);
  if (!aPoster.length && !nouveaux.length && !nouvellesSoirees.length) return;
  // premier passage rapide (sans navigateur) : on dit seulement s'il y a quelque chose à faire
  if (process.env.VERIF_SEUL === '1') {
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'a_faire=1\n');
    return;
  }

  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 420, height: 1000 }, deviceScaleFactor: 3 });
  await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
  // attendre que le site ait lu le Sheet (calendrier et résultats)
  await page.waitForFunction(() => window._ligueRows && window._ligueRows.length && typeof MC_CALENDRIER !== 'undefined' && MC_CALENDRIER.length, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const poster = async (texte, image, fichier) => {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: texte, attachments: [{ id: 0, filename: fichier }] }));
    form.append('files[0]', new Blob([image], { type: 'image/png' }), fichier);
    const r = await fetch(WEBHOOK, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`Discord a refusé l'annonce (${r.status}) : ${await r.text()}`);
    console.log('Annonce postée :', texte.replace(/\n/g, ' '));
  };

  for (const c of aPoster) {
    const trouvee = await page.evaluate(c => {
      const cible = MC_CALENDRIER.find(x => x[0] === c.date && x[1] === c.ligue && x[2] === c.nom);
      if (!cible) return null;
      mcRenderRace(cible);
      const div = MC_DIVISIONS.find(x => x.code === c.ligue);
      return { nomLigue: div ? div.nom : c.ligue };
    }, c);
    if (!trouvee) { console.log('Course absente du site :', c); continue; }
    // laisser charger la photo de la voiture
    await page.waitForFunction(() => { const i = document.querySelector('#mcRace img'); return !i || i.complete; }, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    const image = await page.locator('#mcRace').screenshot();
    const texte = `🏁 **Ce soir : ${trouvee.nomLigue}${c.nom && c.nom !== trouvee.nomLigue ? ', ' + c.nom : ''}**` + (c.heure ? ` (départ ${c.heure.replace(':', 'h')})` : '') + `\n📍 ${c.circuit}`;
    await poster(texte, image, 'course.png');
    if (!ESSAI) etat[`${c.date}|${c.ligue}|${c.nom}`] = new Date().toISOString();
  }

  if (nouveaux.length) {
    const vus = Array.isArray(dejaVus) ? dejaVus.slice() : [];
    for (const a of nouveaux.reverse()) { // du plus ancien au plus récent
      const ok = await page.evaluate(id => {
        const s = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
        const art = (_mcArticles.length ? _mcArticles : mcCollectArticles()).find(x => s(x.titre) === id);
        if (!art) return false;
        let boite = document.getElementById('mcCadreAnnonce');
        if (!boite) { boite = document.createElement('div'); boite.id = 'mcCadreAnnonce'; boite.style.cssText = 'position:absolute;left:0;top:0;width:420px;z-index:99999;background:#001226;padding:0'; document.body.prepend(boite); }
        boite.innerHTML = mcStory(art, 'big', true);
        return true;
      }, a.id);
      if (!ok) { console.log('Article introuvable sur la page, ignoré :', a.titre); vus.push(a.id); fs.writeFileSync(ETAT_ARTICLES, JSON.stringify(vus, null, 1) + '\n'); continue; }
      await page.waitForFunction(() => { const i = document.querySelector('#mcCadreAnnonce img'); return !i || i.complete; }, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      const image = await page.locator('#mcCadreAnnonce .mc-story').screenshot();
      await poster(`📰 **Nouvel article : ${a.titre}**\n<${SITE.replace(/\/?$/, '/')}#article-${a.id}>`, image, 'article.png');
      vus.push(a.id);
      fs.writeFileSync(ETAT_ARTICLES, JSON.stringify(vus, null, 1) + '\n');
    }
  }

  if (nouvellesSoirees.length) {
    const vus = Array.isArray(resVus) ? resVus.slice() : [];
    for (const x of nouvellesSoirees) {
      const info = await page.evaluate(({ date, ligue }) => {
        const html = mcCadreResultats(date, ligue);
        if (!html) return null;
        let boite = document.getElementById('mcCadreAnnonce');
        if (!boite) { boite = document.createElement('div'); boite.id = 'mcCadreAnnonce'; boite.style.cssText = 'position:absolute;left:0;top:0;z-index:99999;display:flex;gap:20px;align-items:flex-start'; document.body.prepend(boite); }
        boite.innerHTML = html;
        const div = MC_DIVISIONS.find(v => v.code === ligue);
        return { nomLigue: div ? div.nom : ligue, circuit: (boite.querySelector('.mc-res-c') || {}).textContent || '' };
      }, x);
      vus.push(`${x.date}|${x.ligue}`);
      if (!info) { console.log('Résultats absents de la page, ignorés :', x); fs.writeFileSync(ETAT_RESULTATS, JSON.stringify(vus, null, 1) + '\n'); continue; }
      await page.waitForFunction(() => [...document.querySelectorAll('#mcCadreAnnonce img')].every(i => i.complete), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(600);
      // plus de 4 pilotes : plusieurs fiches, une image chacune (la première porte le message)
      const fiches = page.locator('#mcCadreAnnonce .mc-res');
      const nb = await fiches.count();
      for (let i = 0; i < nb; i++) {
        const image = await fiches.nth(i).screenshot();
        const texte = i === 0 ? `🏁 **Résultats : ${info.nomLigue}**` + (info.circuit ? `, ${info.circuit}` : '') + `\n<${SITE.replace(/\/?$/, '/')}>` : '';
        await poster(texte, image, nb > 1 ? `resultats-${i + 1}.png` : 'resultats.png');
      }
      if (!ESSAI) fs.writeFileSync(ETAT_RESULTATS, JSON.stringify(vus, null, 1) + '\n');
    }
  }

  await navigateur.close();
  // ne garder que les 60 derniers jours dans le fichier d'état des courses
  const limite = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  for (const k of Object.keys(etat)) if (k.slice(0, 10) < limite) delete etat[k];
  fs.writeFileSync(ETAT, JSON.stringify(etat, null, 1) + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });
