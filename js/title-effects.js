/* ============================================================
   ZADE — title-effects.js
   Shared page-title effect engine. Used by js/app.js (live site)
   and admin.html (effect previews).
   Exposes: window.ZazaTitleEffects = { effects, names, start }
   ============================================================ */
(function (root) {
  'use strict';
  const rand = (a, b) => Math.random() * (b - a) + a;

  // Each effect is a generator: yields { text, delay, hold }.
  // `titles` is the list from config; the generator cycles through them itself.
  const TITLE_EFFECTS = {
    // Classic: type out, pause, delete, next
    *typewriter(titles) {
      let ti = 0, ci = 0, deleting = false;
      while (true) {
        const t = titles[ti];
        if (!deleting) {
          ci++;
          yield { text: t.slice(0, ci), delay: rand(60, 100), hold: ci === t.length ? 2800 : 0 };
          if (ci === t.length) deleting = true;
        } else {
          ci--;
          yield { text: t.slice(0, ci) || '|', delay: 34, hold: 0 };
          if (ci === 0) { deleting = false; ti = (ti + 1) % titles.length; }
        }
      }
    },

    // Simple crossfade-style swap: show each title, hold, next
    *swap(titles) {
      let ti = 0;
      while (true) { yield { text: titles[ti], delay: 100, hold: 2600 }; ti = (ti + 1) % titles.length; }
    },

    // Text scrolls left like a marquee
    *marquee(titles) {
      let ti = 0, off = 0;
      const t2 = titles.map(x => x + '   ');
      while (true) {
        const t = t2[ti];
        yield { text: t.slice(off) + t.slice(0, off), delay: 120, hold: 0 };
        off = (off + 1) % t.length;
        if (off === 0) ti = (ti + 1) % titles.length;
      }
    },

    // Text slides in from the right, then exits left
    *slide(titles) {
      let ti = 0, phase = 0, k = 0;
      while (true) {
        const t = titles[ti];
        if (phase === 0) { // entering
          yield { text: ' '.repeat(t.length - k) + t.slice(0, k), delay: 60, hold: 0 };
          if (++k > t.length) { phase = 1; k = 0; }
        } else if (phase === 1) { // hold
          yield { text: t, delay: 60, hold: 2400 };
          phase = 2;
        } else { // exiting
          yield { text: t.slice(k) + ' '.repeat(k), delay: 60, hold: 0 };
          if (++k > t.length) { phase = 0; k = 0; ti = (ti + 1) % titles.length; }
        }
      }
    },

    // Letters resolve from random noise, one position at a time
    *scramble(titles) {
      const chars = '!<>-_\\/[]{}\u2014=+*^?#________';
      let ti = 0, revealed = 0;
      while (true) {
        const t = titles[ti];
        if (revealed >= t.length) {
          yield { text: t, delay: 60, hold: 2400 };
          revealed = 0; ti = (ti + 1) % titles.length;
        } else {
          revealed++;
          let out = '';
          for (let i = 0; i < t.length; i++) out += i < revealed ? t[i] : chars[Math.floor(Math.random() * chars.length)];
          yield { text: out, delay: 45, hold: 0 };
        }
      }
    },

  // Corrupted/glitchy text that occasionally snaps clean
  *glitch(titles) {
    const chars = '!@#$%&*+=?<>/\\|';
    let ti = 0, frame = 0;
    while (true) {
      const t = titles[ti];
      if (frame >= 14) { yield { text: t, delay: 60, hold: 1800 }; frame = 0; ti = (ti + 1) % titles.length; }
      else {
        let out = '';
        for (const ch of t) out += (Math.random() < 0.18 && ch !== ' ') ? chars[Math.floor(Math.random() * chars.length)] : ch;
        yield { text: out, delay: 90, hold: 0 };
        frame++;
      }
    }
  },

  // First letter rotates to the end (carousel)
  *rotate(titles) {
    let ti = 0, off = 0;
    const t2 = titles.map(x => x + ' ');
    while (true) {
      const t = t2[ti];
      yield { text: t.slice(off) + t.slice(0, off), delay: 160, hold: 0 };
      off = (off + 1) % t.length;
      if (off === 0) ti = (ti + 1) % titles.length;
    }
  },

  // Case toggles along the string, wave-like
  *caseWave(titles) {
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      let out = '';
      for (let i = 0; i < t.length; i++) {
        const up = (i + f) % 4 < 2;
        out += up ? t[i].toUpperCase() : t[i].toLowerCase();
      }
      yield { text: out, delay: 110, hold: 0 };
      if (++f >= 8) { f = 0; ti = (ti + 1) % titles.length; }
    }
  },

  // Blink on/off
  *blink(titles) {
    let ti = 0, on = true;
    while (true) {
      yield { text: on ? titles[ti] : '\u00b7', delay: 100, hold: on ? 2000 : 400 };
      on = !on;
      if (on) ti = (ti + 1) % titles.length;
    }
  },

  // Text bounces horizontally on leading dots
  *bounce(titles) {
    let ti = 0, k = 0, dir = 1;
    while (true) {
      const t = titles[ti];
      yield { text: '.'.repeat(k) + (k ? ' ' : '') + t, delay: 110, hold: 0 };
      k += dir;
      if (k >= 6) dir = -1;
      if (k <= 0 && dir < 0) { dir = 1; ti = (ti + 1) % titles.length; }
    }
  },

  // Alternates between normal and reversed
  *reverse(titles) {
    let ti = 0, flip = false;
    while (true) {
      const t = titles[ti];
      yield { text: flip ? [...t].reverse().join('') : t, delay: 80, hold: flip ? 700 : 2200 };
      flip = !flip;
      if (flip) ti = (ti + 1) % titles.length;
    }
  },

  // Sparkles orbit around the text
  *sparkle(titles) {
    const deco = [['~ ', ' ~'], [' ~', '~ '], ['', ''], [' ~ ', ' ']];
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      const [a, b] = deco[f];
      yield { text: a + t + b, delay: 100, hold: 0 };
      if (++f >= deco.length) { f = 0; ti = (ti + 1) % titles.length; }
    }
  },

  // Types forward then backward without deleting (ping-pong cursor)
  *pingpong(titles) {
    let ti = 0, i = 0, dir = 1;
    while (true) {
      const t = titles[ti];
      i += dir;
      yield { text: t.slice(0, Math.max(1, Math.min(i, t.length))), delay: 70, hold: (dir > 0 && i >= t.length) ? 1800 : (dir < 0 && i <= 1) ? 400 : 0 };
      if (i >= t.length) dir = -1;
      if (i <= 1) { dir = 1; ti = (ti + 1) % titles.length; }
    }
  },

  // Letters fade in from spaces, one at a time
  *reveal(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k >= t.length) { yield { text: t, delay: 60, hold: 2400 }; k = 0; ti = (ti + 1) % titles.length; }
      else yield { text: t.slice(0, k) + ' '.repeat(t.length - k), delay: 55, hold: 0 }, k++;
    }
  },

  // Types from the end of the word backwards
  *typeBack(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k >= t.length) { yield { text: t, delay: 60, hold: 2200 }; k = 0; ti = (ti + 1) % titles.length; }
      else yield { text: t.slice(t.length - ++k), delay: 65, hold: 0 };
    }
  },

  // Whole text slides right and back (snake)
  *snake(titles) {
    let ti = 0, k = 0, dir = 1;
    while (true) {
      const t = titles[ti];
      yield { text: ' '.repeat(k) + t, delay: 90, hold: 0 };
      k += dir;
      if (k >= 8) dir = -1;
      if (k <= 0 && dir < 0) { dir = 1; ti = (ti + 1) % titles.length; }
    }
  },

  // Loading dots appended 1..3
  *dots(titles) {
    let ti = 0, k = 1;
    while (true) {
      const t = titles[ti];
      yield { text: t + '.'.repeat(k), delay: 100, hold: 0 };
      if (++k > 3) { k = 1; ti = (ti + 1) % titles.length; }
    }
  },

  // Classic terminal spinner prefix
  *spinner(titles) {
    const frames = ['|', '/', '-', '\\'];
    let ti = 0, f = 0;
    while (true) {
      yield { text: frames[f] + ' ' + titles[ti], delay: 120, hold: 0 };
      if (++f >= frames.length) { f = 0; ti = (ti + 1) % titles.length; }
    }
  },

  // Block shade builds across the text
  *blocks(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k > t.length) { yield { text: t, delay: 60, hold: 2000 }; k = 0; ti = (ti + 1) % titles.length; }
      else yield { text: '#'.repeat(k) + t.slice(k), delay: 70, hold: 0 }, k++;
    }
  },

  // SHOUTS then whispers
  *caps(titles) {
    let ti = 0, up = true;
    while (true) {
      const t = titles[ti];
      yield { text: up ? t.toUpperCase() : t.toLowerCase(), delay: 80, hold: up ? 2000 : 900 };
      up = !up;
      if (up) ti = (ti + 1) % titles.length;
    }
  },

  // all lowercase, quiet mode
  *lower(titles) {
    let ti = 0;
    while (true) { yield { text: titles[ti].toLowerCase(), delay: 100, hold: 2600 }; ti = (ti + 1) % titles.length; }
  },

  // Adjacent letters randomly swap places
  *jumble(titles) {
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      if (f >= 10) { yield { text: t, delay: 60, hold: 2000 }; f = 0; ti = (ti + 1) % titles.length; }
      else {
        const a = t.split('');
        const i = Math.floor(Math.random() * (a.length - 1));
        [a[i], a[i + 1]] = [a[i + 1], a[i]];
        yield { text: a.join(''), delay: 110, hold: 0 };
        f++;
      }
    }
  },

  // Random chars blank out, then restore
  *scatter(titles) {
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      if (f >= 12) { yield { text: t, delay: 60, hold: 2200 }; f = 0; ti = (ti + 1) % titles.length; }
      else {
        yield { text: t.split('').map(c => (Math.random() < 0.25 && c !== ' ') ? ' ' : c).join(''), delay: 90, hold: 0 };
        f++;
      }
    }
  },

  // Underline grows beneath the text
  *underline(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k > t.length) { yield { text: t, delay: 60, hold: 2000 }; k = 0; ti = (ti + 1) % titles.length; }
      else yield { text: t + ' ' + '_'.repeat(k), delay: 70, hold: 0 }, k++;
    }
  },

  // Terminal prompt arrows accumulate
  *arrows(titles) {
    let ti = 0, k = 0, dir = 1;
    while (true) {
      const t = titles[ti];
      yield { text: '>'.repeat(k) + (k ? ' ' : '') + t, delay: 100, hold: 0 };
      k += dir;
      if (k >= 5) dir = -1;
      if (k <= 0 && dir < 0) { dir = 1; ti = (ti + 1) % titles.length; }
    }
  },

  // Brackets close in around the text
  *brackets(titles) {
    let ti = 0, phase = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (phase === 0) {
        yield { text: '['.repeat(k) + t + ']'.repeat(k), delay: 90, hold: 0 };
        if (++k > 2) { phase = 1; }
      } else if (phase === 1) {
        yield { text: '['.repeat(3) + t + ']'.repeat(3), delay: 80, hold: 2000 };
        phase = 2; k = 3;
      } else {
        yield { text: '['.repeat(k) + t + ']'.repeat(k), delay: 90, hold: 0 };
        if (--k <= 0) { phase = 0; k = 0; ti = (ti + 1) % titles.length; }
      }
    }
  },

  // Quotation marks pulse around the text
  *quotes(titles) {
    let ti = 0, on = false;
    while (true) {
      const t = titles[ti];
      yield { text: on ? '"' + t + '"' : t, delay: 90, hold: on ? 900 : 1600 };
      on = !on;
      if (on) ti = (ti + 1) % titles.length;
    }
  },

  // Asterisks orbit around the text
  *stars(titles) {
    const deco = [['* ', ' *'], [' *', '* '], ['', ''], [' * ', ' ']];
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      const [a, b] = deco[f];
      yield { text: a + t + b, delay: 100, hold: 0 };
      if (++f >= deco.length) { f = 0; ti = (ti + 1) % titles.length; }
    }
  },

  // <3 marker hops sides
  *hearts(titles) {
    let ti = 0, left = true;
    while (true) {
      const t = titles[ti];
      yield { text: left ? '<3 ' + t : t + ' <3', delay: 110, hold: 0 };
      left = !left;
      if (left) ti = (ti + 1) % titles.length;
    }
  },

  // Fast type, no delete — straight to next title
  *typeFast(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k >= t.length) { yield { text: t, delay: 50, hold: 2000 }; k = 0; ti = (ti + 1) % titles.length; }
      else yield { text: t.slice(0, ++k), delay: 28, hold: 0 };
    }
  },

  // Breathing — text drifts right and settles back
  *pulse(titles) {
    let ti = 0, k = 0, dir = 1;
    while (true) {
      const t = titles[ti];
      yield { text: ' '.repeat(k) + t, delay: 130, hold: 0 };
      k += dir;
      if (k >= 3) dir = -1;
      if (k <= 0 && dir < 0) { dir = 1; ti = (ti + 1) % titles.length; }
    }
  },

  // Zoom feel — spaces grow on both sides, then collapse
  *zoom(titles) {
    let ti = 0, k = 0, dir = 1;
    while (true) {
      const t = titles[ti];
      yield { text: ' '.repeat(k) + t + ' '.repeat(k), delay: 110, hold: 0 };
      k += dir;
      if (k >= 5) dir = -1;
      if (k <= 0 && dir < 0) { dir = 1; ti = (ti + 1) % titles.length; }
    }
  },

  // Types instantly, holds, then instantly next (strobe swap)
  *typeLoop(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k >= t.length) { yield { text: t, delay: 40, hold: 2400 }; k = 0; ti = (ti + 1) % titles.length; }
      else yield { text: t.slice(0, ++k), delay: 40, hold: 0 };
    }
  },

  // Mirrors the text progressively from the left
  *mirrorBuild(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k > t.length) { yield { text: t, delay: 60, hold: 2000 }; k = 0; ti = (ti + 1) % titles.length; }
      else {
        const shown = t.slice(0, k) + [...t.slice(0, k)].reverse().join('');
        yield { text: shown, delay: 70, hold: 0 };
        k++;
      }
    }
  },

  // Word order shuffles, then restores
  *shuffleWords(titles) {
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      const words = t.split(' ');
      if (words.length < 2 || f >= 6) { yield { text: t, delay: 60, hold: 2200 }; f = 0; ti = (ti + 1) % titles.length; }
      else {
        const a = [...words];
        const i = Math.floor(Math.random() * (a.length - 1));
        [a[i], a[i + 1]] = [a[i + 1], a[i]];
        yield { text: a.join(' '), delay: 140, hold: 0 };
        f++;
      }
    }
  },

  // Shows initials first, then expands to full text
  *initials(titles) {
    let ti = 0, phase = 0;
    while (true) {
      const t = titles[ti];
      if (phase === 0) {
        yield { text: t.split(' ').map(w => w[0] || '').join(' '), delay: 90, hold: 1400 };
        phase = 1;
      } else {
        yield { text: t, delay: 80, hold: 2400 };
        phase = 0; ti = (ti + 1) % titles.length;
      }
    }
  },

  // Random single letter flips case (shiver)
  *shiver(titles) {
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      if (f >= 12) { yield { text: t, delay: 60, hold: 2000 }; f = 0; ti = (ti + 1) % titles.length; }
      else {
        const i = Math.floor(Math.random() * t.length);
        yield { text: t.slice(0, i) + (t[i] === t[i].toUpperCase() ? t[i].toLowerCase() : t[i].toUpperCase()) + t.slice(i + 1), delay: 100, hold: 0 };
        f++;
      }
    }
  },

  // Marquee scrolling right
  *marqueeRight(titles) {
    let ti = 0, off = 0;
    const t2 = titles.map(x => '   ' + x);
    while (true) {
      const t = t2[ti];
      yield { text: t.slice(t.length - off) + t.slice(0, t.length - off), delay: 120, hold: 0 };
      off = (off + 1) % t.length;
      if (off === 0) ti = (ti + 1) % titles.length;
    }
  },

  // Types with random typos that get corrected
  *typo(titles) {
    let ti = 0, k = 0, wrong = false;
    while (true) {
      const t = titles[ti];
      if (k >= t.length) { yield { text: t, delay: 60, hold: 2200 }; k = 0; wrong = false; ti = (ti + 1) % titles.length; }
      else if (wrong) {
        yield { text: t.slice(0, k), delay: 50, hold: 0 };
        wrong = false;
      } else {
        k++;
        wrong = Math.random() < 0.18;
        yield { text: t.slice(0, k - 1) + (wrong ? '?' : t[k - 1]), delay: 65, hold: 0 };
      }
    }
  },

  // Full title shown, then deleted from the front
  *frontDelete(titles) {
    let ti = 0, k = 0;
    while (true) {
      const t = titles[ti];
      if (k === 0) yield { text: t, delay: 60, hold: 2400 }, k++;
      else if (k >= t.length) { yield { text: '|', delay: 40, hold: 200 }; k = 0; ti = (ti + 1) % titles.length; }
      else yield { text: t.slice(k++), delay: 40, hold: 0 };
    }
  },

  // Fast blink
  *blinkFast(titles) {
    let ti = 0, on = true;
    while (true) {
      yield { text: on ? titles[ti] : '', delay: 60, hold: on ? 700 : 180 };
      on = !on;
      if (on) ti = (ti + 1) % titles.length;
    }
  },

  // Heavy corruption — most chars scrambled
  *glitchHard(titles) {
    const chars = '#@$%&*!?<>{}[]';
    let ti = 0, f = 0;
    while (true) {
      const t = titles[ti];
      if (f >= 8) { yield { text: t, delay: 60, hold: 1600 }; f = 0; ti = (ti + 1) % titles.length; }
      else {
        yield { text: t.split('').map(c => (Math.random() < 0.45 && c !== ' ') ? chars[Math.floor(Math.random() * chars.length)] : c).join(''), delay: 70, hold: 0 };
        f++;
      }
    }
  }
};

/* Start an effect against a text sink (document.title or a preview element).
   Returns a stop() function. Mirrors the original app.js titleCycle(). */
function start(titles, effect, speed, sink) {
  speed = parseFloat(speed);
  if (!isFinite(speed) || speed <= 0) speed = 1;
  if (!titles || !titles.length) return () => {};
  titles = titles.filter(Boolean);
  if (!titles.length) return () => {};

  const gen = (TITLE_EFFECTS[effect] || TITLE_EFFECTS.typewriter)(titles);
  let timer = 0;
  let stopped = false;

  function tick() {
    if (stopped) return;
    const { value } = gen.next();
    if (!value) return;
    sink(value.text);
    timer = setTimeout(tick, Math.max(16, (value.delay + (value.hold || 0)) / speed));
  }
  timer = setTimeout(tick, 0);
  return () => { stopped = true; clearTimeout(timer); };
}

root.ZazaTitleEffects = { effects: TITLE_EFFECTS, names: Object.keys(TITLE_EFFECTS), start };
})(window);
