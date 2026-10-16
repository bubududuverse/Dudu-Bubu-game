#!/usr/bin/env python3
"""Saara project -> EK index.html (GitHub Pages single-file host ke liye).

- style.css + tag.css  -> <style> inline
- engine/sprites/game/tag.js -> ek <script> inline
- bubu.png + dudu.png  -> Base64 data-URI (sprites list + <img src>)
- dono games ek page par: window.showPage('runner'|'tag') switcher
Usage: python3 tools/build_single.py   ->  ../github-pages/index.html
"""
import base64
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(os.path.dirname(ROOT), 'github-pages', 'index.html')


def rd(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()


def b64(p):
    with open(os.path.join(ROOT, p), 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


BUBU_URI = 'data:image/png;base64,' + b64('assets/images/bubu.png')
DUDU_URI = 'data:image/png;base64,' + b64('assets/images/dudu.png')

style = rd('style.css') + '\n' + rd('tag.css') + '''
/* ---- single-file page switcher ---- */
.page { position: relative; width: 100%; height: 100vh; height: 100dvh; display: none; overflow: hidden; }
.page.active { display: block; }
'''

js = '\n'.join([
    rd('js/engine.js'),
    rd('js/sprites.js').replace("'assets/images/bubu.png'", "'" + BUBU_URI + "'")
                        .replace("'assets/images/dudu.png'", "'" + DUDU_URI + "'"),
    rd('js/game.js'),
    rd('js/tag.js'),
    '''
/* ---- single-file glue: in-page switching between the two games ---- */
window.PAGE = 'runner';
window.showPage = function (name) {
  if (window.PAGE === name) return;
  if (window.PAGE === 'runner' && window.Game && Game.getState() === 'playing') Game.pause();
  if (window.PAGE === 'tag' && window.TagGame && TagGame.getState() === 'play') TagGame.pause();
  window.PAGE = name;
  document.getElementById('pageRunner').classList.toggle('active', name === 'runner');
  document.getElementById('pageTag').classList.toggle('active', name === 'tag');
  setTimeout(function () {
    var id = name === 'runner' ? 'gameCanvas' : 'tagCanvas';
    Engine.Canvas.use(id);
    if (Engine.Canvas.cur) Engine.Canvas.cur.resize();
    Engine.Canvas.use(id);
  }, 30);
};
'''])

index_html = rd('index.html')
tag_html = rd('tag.html')
m_run = re.search(r'<div class="game-wrapper">\n(.*?)\n    </div>\n\n    <!-- Loading Screen -->',
                  index_html, re.S)
m_tag = re.search(r'<div class="game-wrapper">\n(.*?)\n    </div>\n\n    <!-- Loading -->',
                  tag_html, re.S)
assert m_run and m_tag, 'wrapper extraction failed'
runner_inner, tag_inner = m_run.group(1), m_tag.group(1)

loading = re.search(r'(<div class="loading-screen".*?</div>\n    </div>)', index_html, re.S).group(1)

body = f'''    <div class="page active" id="pageRunner">
      <div class="game-wrapper">
{runner_inner}
      </div>
    </div>

    <div class="page" id="pageTag">
      <div class="game-wrapper">
{tag_inner}
      </div>
    </div>

    {loading}'''
body = body.replace('src="assets/images/bubu.png"', 'src="' + BUBU_URI + '"')
body = body.replace('src="assets/images/dudu.png"', 'src="' + DUDU_URI + '"')

doc = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="description" content="Bubu a Bubududu — Runner + TAG Mode, single-file edition. Made with love by the couple!">
    <meta name="theme-color" content="#155c3d">
    <title>Bubu a Bubududu Adventure — Complete</title>
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Bubblegum+Sans&display=swap" rel="stylesheet">
    <style>
{style}
    </style>
</head>
<body>
{body}

    <script>
{js}
    </script>
</body>
</html>
'''

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(doc)
print('single file written:', OUT, os.path.getsize(OUT), 'bytes')
