"""Victoires déclarées sur Discord (commande /victoire) et validées par Alexis ou le Président.

    python3 outils/victoires.py recuperer   -> enregistre photos + assets/victoires.json, note les ids
    python3 outils/victoires.py marquer     -> marque ces victoires « En ligne » sur Discord

Variables : RELAIS_CLE (secret GitHub), RELAIS_URL (facultatif).
"""
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request

RELAIS = os.environ.get('RELAIS_URL', 'https://meatball-relais.alexis-joube.workers.dev/')
CLE = os.environ.get('RELAIS_CLE', '')
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DONNEES = os.path.join(RACINE, 'assets', 'victoires.json')
DOSSIER = os.path.join(RACINE, 'assets', 'victoires')
IDS = os.path.join(os.environ.get('RUNNER_TEMP', '/tmp'), 'victoires-ids.json')


def relais(donnees):
    req = urllib.request.Request(RELAIS, data=json.dumps(donnees).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'X-Relais-Cle': CLE,
                                          'User-Agent': 'meatball-mc-site'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def slug(t):
    t = unicodedata.normalize('NFD', t).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')


def recuperer():
    from PIL import Image
    liste = relais({'action': 'victoires_validees'})
    existantes = json.load(open(DONNEES, encoding='utf-8')) if os.path.exists(DONNEES) else []
    connues = {v.get('id') for v in existantes}
    faites = []
    for v in liste:
        faites.append(v['id'])
        if v['id'] in connues:
            continue
        req = urllib.request.Request(v['image'], headers={'User-Agent': 'meatball-mc-site'})
        with urllib.request.urlopen(req, timeout=60) as r:
            im = Image.open(io.BytesIO(r.read())).convert('RGB')
        im.thumbnail((1400, 1400))
        nom = '-'.join(x for x in [slug(v['pilote']), v.get('num') or '', slug(v['circuit']), v['id'][-6:]] if x) + '.jpg'
        os.makedirs(DOSSIER, exist_ok=True)
        im.save(os.path.join(DOSSIER, nom), quality=85, optimize=True)
        entree = {'id': v['id'], 'img': 'assets/victoires/' + nom, 'pilote': v['pilote'], 'num': v.get('num') or '',
                  'ligue': v['course'], 'date': v['date'],
                  # SOF ajouté au nom du circuit, comme pour les victoires saisies à la main : « Kentucky (SOF 2527) »
                  'circuit': v['circuit'] + (' (SOF ' + str(v['sof']).strip() + ')' if str(v.get('sof') or '').strip() else ''),
                  # Les ligues de l'équipe sont déjà comptées par RESULTATS LIGUE
                  'horsSheet': v.get('type') != "Ligue de l'équipe"}
        if v.get('mot'):
            entree['mot'] = v['mot']
        existantes.append(entree)
        print('Nouvelle victoire :', v['pilote'], v['course'], entree['circuit'], v['date'])
    with open(DONNEES, 'w', encoding='utf-8') as f:
        f.write(json.dumps(existantes, ensure_ascii=False, indent=1) + '\n')
    json.dump(faites, open(IDS, 'w'))
    print(len(faites), 'victoire(s) validée(s) traitée(s)')


def marquer():
    if not os.path.exists(IDS):
        return
    for i in json.load(open(IDS)):
        relais({'action': 'victoire_publiee', 'id': i})
        print('Marquée en ligne :', i)


if __name__ == '__main__':
    if not CLE:
        print('RELAIS_CLE absent : rien à faire')
        sys.exit(0)
    {'recuperer': recuperer, 'marquer': marquer}[sys.argv[1]]()
