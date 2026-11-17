// Annonce Discord automatique des courses du soir.
// Lancé toutes les 15 minutes par GitHub (.github/workflows/annonce-course.yml).
// Pour chaque course du jour dans l'onglet CALENDRIER du Sheet :
//   - heure de départ renseignée (colonne G) : l'annonce part 4 heures avant ;
//   - pas d'heure : l'annonce part à 17h ;
// on photographie le cadre « Prochaine course » du site pour cette course et on le poste
// sur Discord par le webhook (secret GitHub DISCORD_WEBHOOK_COURSES). Une seule fois par course :
// les courses déjà annoncées sont notées dans le fichier passé en argument.
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHEET = '1xyAVmXsdmOs_8q6jFZkJLd9prrofzAQJ_YlI-Ssf84E';
const GID_CALENDRIER = 494383415;
const SITE = process.env.SITE_URL || 'https://meatball-mc.fr/';
const WEBHOOK = process.env.DISCORD_WEBHOOK_COURSES;
const ETAT = process.argv[2] || 'annonces.json';
const AVANCE_MIN = 4 * 60;      // 4 heures avant le départ
const HEURE_DEFAUT = '17:00';   // sans heure de départ
const ESSAI = process.env.ESSAI === '1'; // essai : poste la prochaine course même si ce n'est pas l'heure

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

async function main() {
  // tant que le webhook n'est pas enregistré dans les secrets GitHub, on ne fait rien (sans erreur)
  if (!WEBHOOK) { console.log('Secret DISCORD_WEBHOOK_COURSES absent : aucune annonce.'); return; }
  const csv = await (await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID_CALENDRIER}`)).text();
  const courses = lireCsv(csv).slice(1)
    .map(r => ({ date: iso(r[0]), ligue: (r[1] || '').trim(), nom: (r[2] || '').trim(), circuit: (r[3] || '').trim(), heure: heure(r[6]) }))
    .filter(c => c.date && c.ligue);
  const { jour, minutes: mtn } = maintenantParis();
  let etat = {};
  try { etat = JSON.parse(fs.readFileSync(ETAT, 'utf8')); } catch (e) {}

  let aPoster;
  if (ESSAI) {
    aPoster = courses.filter(c => c.date >= jour).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 1);
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
  console.log(`${jour} ${Math.floor(mtn / 60)}h${String(mtn % 60).padStart(2, '0')} : ${aPoster.length} annonce(s) à faire`);
  if (!aPoster.length) return;
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
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: texte, attachments: [{ id: 0, filename: 'course.png' }] }));
    form.append('files[0]', new Blob([image], { type: 'image/png' }), 'course.png');
    const r = await fetch(WEBHOOK, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`Discord a refusé l'annonce (${r.status}) : ${await r.text()}`);
    console.log('Annonce postée :', texte.replace(/\n/g, ' '));
    if (!ESSAI) etat[`${c.date}|${c.ligue}|${c.nom}`] = new Date().toISOString();
  }
  await navigateur.close();
  // ne garder que les 60 derniers jours dans le fichier d'état
  const limite = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  for (const k of Object.keys(etat)) if (k.slice(0, 10) < limite) delete etat[k];
  fs.writeFileSync(ETAT, JSON.stringify(etat, null, 1) + '\n');
}

main().catch(e => { console.error(e); process.exit(1); });
