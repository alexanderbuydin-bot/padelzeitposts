'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const storage = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* privater Modus: dann eben ohne */ }
    },
  };

  const SEND_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const DOWNLOAD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 19.5h14"/></svg>';
  const COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/></svg>';
  const CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const SPINNER =
    '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';
  const EMPTY = { yes: [], no: [], mine: 0, comments: [], status: null };
  const SWIPE_W = 156; // so weit fährt die Karte beim Wischen nach rechts auf
  const POLL_MS = 20000;

  const clientId = storage.get('pz-client') || newId();
  storage.set('pz-client', clientId);
  let myName = storage.get('pz-name') || '';
  let afterName = null; // Aktion, die auf den Namen wartet

  let posts = [];
  let state = {};
  const cards = new Map();

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // ---------- Server ----------

  async function api(path, payload) {
    const options = payload
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, name: myName, ...payload }),
        }
      : { cache: 'no-store' };
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
  }

  async function refresh() {
    try {
      applyState(await api(`/api/state?client=${encodeURIComponent(clientId)}`));
    } catch {
      /* offline – beim nächsten Mal */
    }
  }

  function applyState(data) {
    state = data.posts || {};
    for (const id of cards.keys()) updateCard(id);
    placeCards();
    updateProgress();
  }

  function statusOf(postId) {
    const s = (state[postId] || EMPTY).status;
    return s ? s.state : 'open';
  }

  // ---------- Karte bauen ----------

  function buildCard(post) {
    const root = el('article', 'card');
    root.id = post.id;
    const total = post.slides.length;

    const slides = el('div', 'slides');
    slides.style.setProperty('--ratio', `${post.slides[0].w} / ${post.slides[0].h}`);
    const track = el('div', 'slides__track');
    track.tabIndex = 0;
    track.setAttribute('aria-label', `Slides: ${post.title}`);
    post.slides.forEach((s, i) => {
      const slide = el('div', 'slide');
      const img = new Image();
      img.src = s.small;
      img.srcset = `${s.small} ${s.sw}w, ${s.src} ${s.w}w`;
      img.sizes = '(max-width: 719px) 100vw, (max-width: 1099px) 50vw, 380px';
      img.alt = `${post.title} – Slide ${i + 1} von ${total}`;
      img.loading = i === 0 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      slide.append(img);
      slide.addEventListener('click', () => openViewer(post, i));
      track.append(slide);
    });

    const count = el('span', 'chip chip--count');
    const dots = el('div', 'dots');
    post.slides.forEach((_, i) => {
      const dot = el('button', 'dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Slide ${i + 1}`);
      dot.addEventListener('click', () => goTo(track, i));
      dots.append(dot);
    });
    const prev = navButton('prev', '‹', 'Vorherige Slide', () => goTo(track, index(track) - 1));
    const next = navButton('next', '›', 'Nächste Slide', () => goTo(track, index(track) + 1));
    slides.append(track, count, dots, prev, next);
    if (post.isNew) slides.append(el('span', 'chip chip--new', 'Neu'));

    const sync = () => {
      const i = index(track);
      count.textContent = `${i + 1} / ${total}`;
      [...dots.children].forEach((dot, k) => dot.classList.toggle('is-active', k === i));
      prev.disabled = i === 0;
      next.disabled = i === total - 1;
    };
    let frame = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    }, { passive: true });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') goTo(track, index(track) + 1);
      if (e.key === 'ArrowLeft') goTo(track, index(track) - 1);
    });
    sync();

    const body = el('div', 'card__body');
    const head = el('div', 'card__head');
    const verdict = el('span', 'verdict');
    const more = el('button', 'more', '⋯');
    more.type = 'button';
    more.setAttribute('aria-label', 'Gepostet oder löschen');
    head.append(el('h2', 'card__title', post.title), verdict, more);
    const statusLine = el('p', 'status-line');

    const vote = el('div', 'vote');
    const yes = voteButton('yes', '👍', 'Posten');
    const no = voteButton('no', '👎', 'Nicht posten');
    yes.btn.addEventListener('click', () => castVote(post.id, 1));
    no.btn.addEventListener('click', () => castVote(post.id, -1));
    vote.append(yes.btn, no.btn);

    const voters = el('p', 'voters');
    const comments = el('ul', 'comments');

    const form = el('form', 'comment-form');
    const input = el('input', 'comment-form__input');
    input.type = 'text';
    input.maxLength = 280;
    input.placeholder = 'Kurzer Kommentar …';
    input.enterKeyHint = 'send';
    input.setAttribute('aria-label', `Kommentar zu „${post.title}“`);
    const send = el('button', 'comment-form__send');
    send.type = 'submit';
    send.disabled = true;
    send.setAttribute('aria-label', 'Kommentar senden');
    send.innerHTML = SEND_ICON;
    input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendComment(post.id, input, send);
    });
    form.append(input, send);

    body.append(head, statusLine, vote, voters, comments, form, buildTools(post), buildCaption(post));
    const inner = el('div', 'card__inner');
    inner.append(slides, body);
    const actions = el('div', 'card__actions');
    root.append(actions, inner);
    const card = { post, root, inner, actions, slides, body, verdict, statusLine, yes, no, voters, comments, open: false, shown: '' };
    more.addEventListener('click', () => setOpen(card, !card.open));
    enableSwipe(card);
    return card;
  }

  // ---------- Wischen: gepostet / löschen ----------

  let openCard = null;

  function setOpen(card, open) {
    if (open && openCard && openCard !== card) setOpen(openCard, false);
    card.open = open;
    card.root.classList.toggle('is-open', open);
    card.inner.style.transform = open ? `translateX(${SWIPE_W}px)` : '';
    card.actions.style.paddingTop = `${card.slides.offsetHeight}px`; // Knöpfe neben dem Textteil, wo der Finger ist
    if (open) openCard = card;
    else if (openCard === card) openCard = null;
  }

  function enableSwipe(card) {
    const { body, inner } = card;
    let drag = null;
    let swallowUntil = 0;
    body.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('input, .caption')) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId, mode: '', base: card.open ? SWIPE_W : 0, dx: 0 };
    });
    body.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const mx = e.clientX - drag.x;
      const my = e.clientY - drag.y;
      if (!drag.mode) {
        if (Math.hypot(mx, my) < 9) return;
        drag.mode = Math.abs(mx) > Math.abs(my) * 1.3 ? 'swipe' : 'scroll';
        if (drag.mode === 'swipe') {
          body.setPointerCapture(e.pointerId);
          card.root.classList.add('is-dragging');
          card.actions.style.paddingTop = `${card.slides.offsetHeight}px`;
          if (openCard && openCard !== card) setOpen(openCard, false);
        }
      }
      if (drag.mode !== 'swipe') return;
      drag.dx = Math.max(0, Math.min(SWIPE_W * 1.2, drag.base + mx));
      inner.style.transform = `translateX(${drag.dx}px)`;
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.mode === 'swipe') {
        card.root.classList.remove('is-dragging');
        setOpen(card, drag.dx > SWIPE_W * 0.45);
        swallowUntil = performance.now() + 150; // der Klick nach dem Wischen zählt nicht
      }
      drag = null;
    };
    body.addEventListener('pointerup', end);
    body.addEventListener('pointercancel', end);
    inner.addEventListener('click', (e) => {
      if (performance.now() < swallowUntil) {
        e.preventDefault();
        e.stopPropagation();
      } else if (card.open) {
        // offene Karte: ein Tipp darauf schließt sie wieder
        e.preventDefault();
        e.stopPropagation();
        setOpen(card, false);
      }
    }, true);
  }

  const ACTIONS = {
    open: [['posted', '✓', 'Gepostet', 'act--post'], ['deleted', '🗑', 'Löschen', 'act--delete']],
    posted: [['open', '↩', 'Doch nicht gepostet', 'act--back'], ['deleted', '🗑', 'Löschen', 'act--delete']],
    deleted: [['open', '↩', 'Zurückholen', 'act--back']],
  };

  function renderActions(card) {
    const current = statusOf(card.post.id);
    if (card.shown === current) return;
    card.shown = current;
    card.actions.replaceChildren(...ACTIONS[current].map(([next, icon, label, kind]) => {
      const b = el('button', `act ${kind}`);
      b.type = 'button';
      b.append(el('span', 'act__icon', icon), el('span', 'act__label', label));
      b.addEventListener('click', () => setStatus(card.post, next));
      return b;
    }));
  }

  const STATUS_TOAST = { posted: 'Als gepostet markiert', deleted: 'Gelöscht – liegt unten im Papierkorb', open: 'Wieder offen' };

  async function setStatus(post, next, withUndo = true) {
    if (!ensureName(() => setStatus(post, next, withUndo))) return;
    const current = state[post.id] || EMPTY;
    const previous = statusOf(post.id);
    state[post.id] = { ...current, status: next === 'open' ? null : { state: next, name: myName, ts: Date.now() } };
    setOpen(cards.get(post.id), false);
    updateCard(post.id);
    placeCards();
    updateProgress();
    if (withUndo) toast(STATUS_TOAST[next], { label: 'Rückgängig', run: () => setStatus(post, previous, false) });
    try {
      applyState(await api('/api/status', { postId: post.id, state: next }));
    } catch (err) {
      toast(`Nicht gespeichert: ${err.message}`);
      refresh();
    }
  }

  // Offene Posts oben, gepostete darunter, gelöschte im zugeklappten Papierkorb – Reihenfolge wie in posts.json
  function placeCards() {
    const grids = { open: $('#grid'), posted: $('#posted-grid'), deleted: $('#trash-grid') };
    const counts = { open: 0, posted: 0, deleted: 0 };
    posts.forEach((p, i) => {
      const where = statusOf(p.id);
      const grid = grids[where];
      const root = cards.get(p.id).root;
      counts[where] += 1;
      if (root.parentElement === grid) return;
      const after = posts.slice(i + 1).map((q) => cards.get(q.id).root).find((r) => r.parentElement === grid);
      grid.insertBefore(root, after || null);
    });
    $('#posted').hidden = !counts.posted;
    $('#posted-count').textContent = counts.posted;
    $('#trash').hidden = !counts.deleted;
    $('#trash-count').textContent = counts.deleted;
  }

  function navButton(kind, label, aria, onClick) {
    const btn = el('button', `nav nav--${kind}`, label);
    btn.type = 'button';
    btn.setAttribute('aria-label', aria);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function voteButton(kind, icon, label) {
    const btn = el('button', `vote__btn vote__btn--${kind}`);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    const count = el('span', 'vote__count');
    count.hidden = true;
    btn.append(el('span', 'vote__icon', icon), el('span', 'vote__label', label), count);
    return { btn, count, label };
  }

  function buildCaption(post) {
    const box = el('details', 'caption');
    box.append(el('summary', 'caption__summary', 'Text zum Post lesen'));
    let lang = 'de';
    const seg = el('div', 'seg');
    const text = el('p', 'caption__text');
    const show = () => {
      text.textContent = post.caption[lang] || '–';
      for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    };
    for (const [key, label] of [['de', 'Deutsch'], ['en', 'English']]) {
      const b = el('button', 'seg__btn', label);
      b.type = 'button';
      b.dataset.lang = key;
      b.addEventListener('click', () => { lang = key; show(); });
      seg.append(b);
    }
    const copy = el('button', 'caption__copy', 'Text kopieren');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      toast((await copyText(post.caption[lang] || '')) ? 'Text kopiert' : 'Kopieren ging nicht – Text lang drücken');
    });
    box.append(seg, text, copy);
    if (post.sources.length) {
      const sources = el('div', 'caption__sources');
      sources.append('Quellen: ');
      post.sources.forEach((line, i) => {
        if (i) sources.append(' · ');
        for (const part of line.split(/(https?:\/\/\S+)/)) {
          if (!part) continue;
          if (/^https?:\/\//.test(part)) {
            const a = el('a', null, new URL(part).hostname.replace(/^www\./, ''));
            a.href = part;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            sources.append(a);
          } else sources.append(part.trim());
        }
      });
      box.append(sources);
    }
    show();
    return box;
  }

  // ---------- Zum Posten: alle Fotos, Text kopieren ----------

  function buildTools(post) {
    const row = el('div', 'tools');
    const photos = toolButton(DOWNLOAD_ICON, 'Alle Fotos', `Alle ${post.slides.length} Fotos laden`);
    photos.btn.classList.add('tool--photos');
    photos.btn.addEventListener('click', () => savePhotos(post, photos));
    row.append(photos.btn);
    for (const [lang, label, aria] of [['en', 'Text EN', 'Englischen Text kopieren'], ['de', 'Text DE', 'Deutschen Text kopieren']]) {
      const tool = toolButton(COPY_ICON, label, aria);
      tool.btn.addEventListener('click', () => copyCaption(post, lang, tool));
      row.append(tool.btn);
    }
    return row;
  }

  function toolButton(icon, label, aria) {
    const btn = el('button', 'tool');
    btn.type = 'button';
    btn.setAttribute('aria-label', aria);
    const tool = {
      btn,
      timer: 0,
      show(svg, text, state = '') {
        btn.innerHTML = svg;
        btn.append(el('span', 'tool__label', text));
        btn.dataset.state = state;
      },
      reset() { tool.show(icon, label); },
    };
    tool.reset();
    return tool;
  }

  async function copyCaption(post, lang, tool) {
    if (!(await copyText(post.caption[lang] || ''))) {
      toast('Kopieren ging nicht – unter „Text zum Post lesen“ lang drücken');
      return;
    }
    clearTimeout(tool.timer);
    tool.show(CHECK_ICON, 'Kopiert', 'done');
    tool.timer = setTimeout(tool.reset, 1600);
  }

  // Fotos einmal laden, beim zweiten Tippen liegen sie schon bereit
  const photoJobs = new Map();

  function loadPhotos(post) {
    let job = photoJobs.get(post.id);
    if (!job) {
      job = { done: 0, onProgress: null };
      job.files = Promise.all(post.slides.map(async (s) => {
        const res = await fetch(s.dl);
        if (!res.ok) throw new Error(`Fehler ${res.status}`);
        const file = new File([await res.blob()], s.dl.split('/').pop(), { type: 'image/jpeg' });
        job.done += 1;
        if (job.onProgress) job.onProgress(job.done);
        return file;
      }));
      job.files.catch(() => photoJobs.delete(post.id));
      photoJobs.set(post.id, job);
    }
    return job;
  }

  // Telefon: Teilen-Menü (iPhone „Bilder sichern“, Instagram, WhatsApp …). PC: eine ZIP-Datei.
  function canShareFiles(files) {
    return matchMedia('(pointer: coarse)').matches && !!navigator.canShare && navigator.canShare({ files });
  }

  async function savePhotos(post, tool) {
    if (tool.btn.dataset.state === 'busy') return;
    const total = post.slides.length;
    const job = loadPhotos(post);
    const progress = (n) => tool.show(SPINNER, `Lädt ${n}/${total}`, 'busy');
    let files;
    try {
      if (job.done < total) {
        progress(job.done);
        job.onProgress = progress;
      }
      files = await job.files;
    } catch {
      tool.reset();
      toast('Fotos konnten nicht geladen werden – bitte nochmal tippen');
      return;
    } finally {
      job.onProgress = null;
    }

    if (canShareFiles(files)) {
      try {
        await navigator.share({ files });
        tool.reset();
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          // Laden hat zu lange gedauert – der Browser verlangt einen frischen Fingertipp
          tool.show(DOWNLOAD_ICON, 'Jetzt sichern', 'ready');
        } else {
          tool.reset();
          if (err.name !== 'AbortError') downloadZip(post, files);
        }
      }
      return;
    }
    tool.reset();
    downloadZip(post, files);
  }

  async function downloadZip(post, files) {
    const folder = post.title.replace(/[\\/:*?"<>|]+/g, '-');
    const entries = await Promise.all(files.map(async (f) => ({
      name: `${folder}/${f.name}`,
      data: new Uint8Array(await f.arrayBuffer()),
    })));
    entries.push({ name: `${folder}/Text.txt`, data: new TextEncoder().encode(captionFile(post)) });
    const url = URL.createObjectURL(window.makeZip(entries));
    const link = el('a');
    link.href = url;
    link.download = `${folder}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`${files.length} Fotos als ZIP geladen`);
  }

  function captionFile(post) {
    const parts = [post.title, '', 'ENGLISH', post.caption.en, '', 'DEUTSCH', post.caption.de];
    if (post.sources.length) parts.push('', 'QUELLEN', ...post.sources);
    return `${parts.join('\n')}\n`;
  }

  // ---------- Slides ----------

  function index(track) {
    return Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
  }

  function goTo(track, i) {
    const last = track.children.length - 1;
    const target = Math.max(0, Math.min(last, i));
    track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
  }

  // ---------- Anzeige aktualisieren ----------

  function updateCard(postId) {
    const card = cards.get(postId);
    const s = state[postId] || EMPTY;

    for (const [part, list, value] of [[card.yes, s.yes, 1], [card.no, s.no, -1]]) {
      part.count.textContent = list.length;
      part.count.hidden = list.length === 0;
      part.btn.setAttribute('aria-pressed', String(s.mine === value));
      part.btn.setAttribute('aria-label', `${part.label}, ${list.length} ${list.length === 1 ? 'Stimme' : 'Stimmen'}`);
    }

    const st = s.status;
    const [kind, label] = st ? [st.state, st.state === 'posted' ? '✓ Gepostet' : 'Gelöscht'] : verdictOf(s);
    card.verdict.className = `verdict verdict--${kind}`;
    card.verdict.textContent = label;
    card.root.dataset.status = st ? st.state : 'open';
    card.statusLine.textContent = st ? `${st.state === 'posted' ? 'Gepostet' : 'Gelöscht'} von ${st.name} · ${ago(st.ts)}` : '';
    renderActions(card);

    card.voters.replaceChildren();
    if (s.yes.length) card.voters.append(el('span', null, `👍 ${s.yes.join(', ')}`));
    if (s.no.length) card.voters.append(el('span', null, `👎 ${s.no.join(', ')}`));

    card.comments.replaceChildren(...s.comments.map((c) => commentItem(postId, c)));
  }

  function verdictOf(s) {
    if (!s.yes.length && !s.no.length) return ['open', 'Noch offen'];
    if (s.yes.length > s.no.length) return ['yes', 'Wird gepostet'];
    if (s.no.length > s.yes.length) return ['no', 'Eher nicht'];
    return ['tie', 'Unentschieden'];
  }

  function commentItem(postId, c) {
    const li = el('li', 'comment');
    const meta = el('div', 'comment__meta');
    const time = el('time', 'comment__time', ago(c.ts));
    time.dateTime = new Date(c.ts).toISOString();
    meta.append(el('span', 'comment__name', c.name), time);
    if (c.mine) {
      const del = el('button', 'comment__del', 'Löschen');
      del.type = 'button';
      let timer = 0;
      del.addEventListener('click', () => {
        if (!del.classList.contains('is-armed')) {
          del.classList.add('is-armed');
          del.textContent = 'Wirklich löschen?';
          timer = setTimeout(() => {
            del.classList.remove('is-armed');
            del.textContent = 'Löschen';
          }, 3000);
          return;
        }
        clearTimeout(timer);
        deleteComment(postId, c.id);
      });
      meta.append(del);
    }
    li.append(meta, el('p', 'comment__text', c.text));
    return li;
  }

  function updateProgress() {
    // nur offene Posts zählen – gepostete und gelöschte sind erledigt
    const open = posts.filter((p) => statusOf(p.id) === 'open');
    const done = open.filter((p) => (state[p.id] || EMPTY).mine !== 0).length;
    $('#progress-fill').style.width = open.length ? `${(done / open.length) * 100}%` : '100%';
    $('#progress-text').textContent = !open.length ? 'Alles erledigt 🙌'
      : done === open.length ? 'Alles bewertet – danke! 🙌' : `${done} von ${open.length} bewertet`;
  }

  function updateMe() {
    $('#me-name').textContent = myName || 'Name eingeben';
    $('#me-avatar').textContent = myName ? myName.charAt(0).toUpperCase() : '?';
  }

  const relative = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

  function ago(ts) {
    const sec = Math.round((ts - Date.now()) / 1000);
    if (Math.abs(sec) < 60) return 'gerade eben';
    const min = Math.round(sec / 60);
    if (Math.abs(min) < 60) return relative.format(min, 'minute');
    const hours = Math.round(min / 60);
    if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 7) return relative.format(days, 'day');
    return new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  }

  // ---------- Aktionen ----------

  async function castVote(postId, value) {
    if (!ensureName(() => castVote(postId, value))) return;
    const current = state[postId] || EMPTY;
    const nextValue = current.mine === value ? 0 : value;

    // Sofort anzeigen, der Server bestätigt danach
    const optimistic = { ...current, yes: [...current.yes], no: [...current.no], mine: nextValue };
    const own = current.mine === 1 ? optimistic.yes : current.mine === -1 ? optimistic.no : null;
    if (own && own.includes(myName)) own.splice(own.indexOf(myName), 1);
    if (nextValue === 1) optimistic.yes.push(myName);
    if (nextValue === -1) optimistic.no.push(myName);
    state[postId] = optimistic;
    updateCard(postId);
    updateProgress();
    if (nextValue && navigator.vibrate) navigator.vibrate(12);

    try {
      applyState(await api('/api/vote', { postId, value: nextValue }));
    } catch (err) {
      toast(`Nicht gespeichert: ${err.message}`);
      refresh();
    }
  }

  async function sendComment(postId, input, send) {
    const text = input.value.trim();
    if (!text) return;
    if (!ensureName(() => sendComment(postId, input, send))) return;
    input.disabled = true;
    send.disabled = true;
    try {
      applyState(await api('/api/comment', { postId, text }));
      input.value = '';
    } catch (err) {
      toast(`Nicht gespeichert: ${err.message}`);
    } finally {
      input.disabled = false;
      send.disabled = !input.value.trim();
    }
  }

  async function deleteComment(postId, commentId) {
    try {
      applyState(await api('/api/comment/delete', { postId, commentId }));
    } catch (err) {
      toast(`Nicht gelöscht: ${err.message}`);
    }
  }

  // ---------- Name ----------

  function ensureName(next) {
    if (myName) return true;
    afterName = next;
    openNameSheet();
    return false;
  }

  function openNameSheet() {
    $('#name-input').value = myName;
    $('#name-sheet').hidden = false;
    setTimeout(() => $('#name-input').focus(), 60);
  }

  function closeNameSheet() {
    $('#name-sheet').hidden = true;
    afterName = null;
  }

  $('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = $('#name-input').value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!value) {
      $('#name-input').focus();
      return;
    }
    const renamed = myName && myName !== value;
    myName = value;
    storage.set('pz-name', value);
    updateMe();
    const next = afterName;
    closeNameSheet();
    if (renamed) {
      try { applyState(await api('/api/rename', {})); } catch { /* nächster Abruf holt es nach */ }
    }
    if (next) next();
  });

  $('#name-skip').addEventListener('click', closeNameSheet);
  $('#name-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeNameSheet(); });
  $('#me').addEventListener('click', openNameSheet);

  // ---------- Großansicht ----------

  const viewer = $('#viewer');
  const viewerTrack = $('#viewer-track');

  function openViewer(post, start) {
    $('#viewer-title').textContent = post.title;
    viewerTrack.replaceChildren(...post.slides.map((s, i) => {
      const slide = el('div', 'viewer__slide');
      const img = new Image();
      img.src = s.src;
      img.alt = `${post.title} – Slide ${i + 1} von ${post.slides.length}`;
      img.decoding = 'async';
      slide.append(img);
      return slide;
    }));
    viewer.hidden = false;
    document.documentElement.classList.add('lock');
    viewerTrack.scrollLeft = start * viewerTrack.clientWidth;
    syncViewer();
    history.pushState({ viewer: true }, '');
    $('#viewer-close').focus({ preventScroll: true });
  }

  function closeViewer(fromHistory) {
    if (viewer.hidden) return;
    viewer.hidden = true;
    document.documentElement.classList.remove('lock');
    viewerTrack.replaceChildren();
    if (!fromHistory) history.back();
  }

  function syncViewer() {
    const total = viewerTrack.children.length;
    const i = index(viewerTrack);
    $('#viewer-count').textContent = `${i + 1} / ${total}`;
    $('#viewer-prev').disabled = i === 0;
    $('#viewer-next').disabled = i === total - 1;
  }

  viewerTrack.addEventListener('scroll', () => requestAnimationFrame(syncViewer), { passive: true });
  $('#viewer-close').addEventListener('click', () => closeViewer(false));
  $('#viewer-prev').addEventListener('click', () => goTo(viewerTrack, index(viewerTrack) - 1));
  $('#viewer-next').addEventListener('click', () => goTo(viewerTrack, index(viewerTrack) + 1));
  window.addEventListener('popstate', () => closeViewer(true));
  document.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    if (e.key === 'Escape') closeViewer(false);
    if (e.key === 'ArrowRight') goTo(viewerTrack, index(viewerTrack) + 1);
    if (e.key === 'ArrowLeft') goTo(viewerTrack, index(viewerTrack) - 1);
  });

  // ---------- Kleinkram ----------

  let toastTimer = 0;
  function toast(message, action) {
    const box = $('#toast');
    box.replaceChildren(el('span', null, message));
    if (action) {
      const btn = el('button', 'toast__action', action.label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        box.classList.remove('is-on');
        action.run();
      });
      box.append(btn);
    }
    box.classList.toggle('has-action', !!action);
    box.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('is-on'), action ? 5000 : 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = el('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  // ---------- Start ----------

  async function init() {
    try {
      const res = await fetch('posts.json', { cache: 'no-cache' });
      posts = (await res.json()).posts;
    } catch {
      $('#loading').textContent = 'Posts konnten nicht geladen werden. Seite neu laden?';
      return;
    }
    const grid = $('#grid');
    for (const post of posts) {
      const card = buildCard(post);
      cards.set(post.id, card);
      grid.append(card.root);
      updateCard(post.id);
    }
    document.addEventListener('pointerdown', (e) => {
      if (openCard && !openCard.root.contains(e.target)) setOpen(openCard, false);
    });
    $('#loading').remove();
    updateMe();
    updateProgress();
    if (!myName) openNameSheet();
    await refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  init();
})();
