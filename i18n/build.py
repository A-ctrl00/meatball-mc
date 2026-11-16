#!/usr/bin/env python3
"""Intègre la version anglaise dans index.html.
Usage : python3 i18n/build.py   (depuis la racine du dépôt)
Recopie i18n/en.json et i18n/engine.js entre les balises <!-- i18n:start --> et <!-- i18n:end -->."""
import json, re, pathlib
racine = pathlib.Path(__file__).resolve().parent.parent
html = (racine / 'index.html').read_text(encoding='utf-8')
dico = json.loads((racine / 'i18n/en.json').read_text(encoding='utf-8'))
moteur = (racine / 'i18n/engine.js').read_text(encoding='utf-8')
bloc = ('<!-- i18n:start -->\n<script type="application/json" id="i18n-en">'
        + json.dumps(dico, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
        + '</script>\n<script>\n' + moteur + '</script>\n<!-- i18n:end -->')
if '<!-- i18n:start -->' in html:
    html = re.sub(r'<!-- i18n:start -->.*?<!-- i18n:end -->', lambda m: bloc, html, flags=re.S)
else:
    i = html.rindex('</body>')
    html = html[:i] + bloc + '\n' + html[i:]
(racine / 'index.html').write_text(html, encoding='utf-8')
print('index.html mis à jour :', len(dico['seg']), 'segments,', len(dico['txt']), 'textes')
