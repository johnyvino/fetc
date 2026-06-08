/**
 * Admin app for Well Made.
 *
 * Single-admin GitHub-as-CMS:
 *   - Fine-grained PAT in localStorage
 *   - In-browser PNG -> WebP encoding (matches tools/optimize_images.py)
 *   - Atomic 4-file commit via the Git Data API
 *
 * Token scope required: Contents Read & Write on this repo only.
 */

(function () {
    'use strict';

    // -------- Config --------
    const REPO_OWNER = 'johnyvino';
    const REPO_NAME  = 'fetc';
    const BRANCH     = 'main';
    const SITE_URL   = 'https://wellmade.johnyvino.com/';

    const TOKEN_KEY    = 'wellmade.adminToken';
    const MAX_FILE_MB  = 20;
    const WEBP_TARGETS = [800, 1600];
    const WEBP_QUALITY = 0.95;

    // -------- DOM --------
    const $ = (id) => document.getElementById(id);

    const authGate    = $('authGate');
    const authForm    = $('authForm');
    const tokenInput  = $('tokenInput');
    const authError   = $('authError');
    const adminMain   = $('adminMain');
    const signOutBtn  = $('signOutBtn');

    const stage         = $('stage');
    const fileInput     = $('fileInput');
    const dropEmpty     = $('dropEmpty');
    const previewCard   = $('previewCard');
    const replaceBtn    = $('replaceBtn');
    const stageHint     = $('stageHint');
    const encodedInfo   = $('encodedInfo');
    const srcInfo       = $('srcInfo');
    const info800       = $('info800');
    const info1600      = $('info1600');

    const itemForm     = $('itemForm');
    const nameInput    = $('nameInput');
    const brandInput   = $('brandInput');
    const slugPreview  = $('slugPreview');
    const publishBtn   = $('publishBtn');
    const statusEl     = $('status');

    // -------- State --------
    let token       = localStorage.getItem(TOKEN_KEY) || '';
    let pickedFile  = null;
    let previewURL  = null;  // blob URL for the in-stage preview <img>; revoked on replace
    /** @type {{ blob800: Blob|null, blob1600: Blob|null, srcW: number, srcH: number }} */
    let encoded     = { blob800: null, blob1600: null, srcW: 0, srcH: 0 };
    let existingIds = new Set();
    /** @type {Array<object>} Full item list for manage tab. */
    let allItems    = [];
    /** @type {string|null} If set, publish becomes update for this id. */
    let editingId   = null;

    // -------- Helpers --------
    const fmtKB = (n) => `${Math.max(1, Math.round(n / 1024))} kB`;

    // HTML-escape helper. Named distinctly so it never falls through to the
    // deprecated global `escape()` which URL-encodes instead of HTML-escaping.
    const esc = (s) => String(s)
        .replaceAll('&',  '&amp;')
        .replaceAll('<',  '&lt;')
        .replaceAll('>',  '&gt;')
        .replaceAll('"',  '&quot;')
        .replaceAll("'",  '&#39;');

    function slugify(text) {
        return String(text)
            .toLowerCase()
            .normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function makeSlug(brand, name) {
        const base = slugify(`${brand || ''} ${name || ''}`) || 'item';
        if (!existingIds.has(base)) return base;
        let i = 2;
        while (existingIds.has(`${base}-${i}`)) i++;
        return `${base}-${i}`;
    }

    function todayISO() {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    function setStatus(text, kind) {
        statusEl.textContent = text || '';
        statusEl.classList.remove('is-success', 'is-error');
        if (kind) statusEl.classList.add(`is-${kind}`);
    }

    // -------- Auth --------
    function showGate(message) {
        document.documentElement.classList.remove('is-authed');
        if (message) {
            authError.textContent = message;
            authError.hidden = false;
        } else {
            authError.hidden = true;
        }
    }

    function showApp() {
        document.documentElement.classList.add('is-authed');
        loadExistingItems().catch(err => {
            if (err.isAuth) {
                // Saved token is bad/expired — wipe it, kick back to gate.
                localStorage.removeItem(TOKEN_KEY);
                token = '';
                showGate('Saved token was rejected by GitHub. Paste a fresh one.');
            } else {
                setStatus(`Could not load items.js: ${err.message}`, 'error');
            }
        });
    }

    if (token) showApp(); else showGate();

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const value = tokenInput.value.trim();
        if (!value) return;

        const submitBtn = authForm.querySelector('button[type="submit"]');
        const submitLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying…';
        authError.hidden = true;

        // Try the token before persisting so we don't store something broken.
        const previousToken = token;
        token = value;
        try {
            await gh(repoPath(''));
            localStorage.setItem(TOKEN_KEY, token);
            tokenInput.value = '';
            showApp();
        } catch (err) {
            token = previousToken;
            authError.hidden = false;
            authError.textContent = err.isAuth
                ? 'GitHub rejected this token. Confirm it’s a fine-grained PAT for johnyvino/fetc with Contents: Read and write, and that it hasn’t expired.'
                : `Verification failed: ${err.message}`;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = submitLabel;
        }
    });

    signOutBtn.addEventListener('click', () => {
        localStorage.removeItem(TOKEN_KEY);
        token = '';
        existingIds = new Set();
        showGate();
    });

    // -------- GitHub API --------
    async function gh(path, opts = {}) {
        const r = await fetch(`https://api.github.com${path}`, {
            ...opts,
            headers: {
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Authorization': `Bearer ${token}`,
                ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
                ...(opts.headers || {}),
            },
        });
        if (r.status === 401 || r.status === 403) {
            const body = await r.text().catch(() => '');
            const err = new Error(`auth failed (${r.status}): ${body.slice(0, 200)}`);
            err.isAuth = true;
            throw err;
        }
        if (!r.ok) {
            const body = await r.text().catch(() => '');
            throw new Error(`GitHub ${r.status}: ${body.slice(0, 300)}`);
        }
        return r.json();
    }

    function repoPath(suffix) {
        return `/repos/${REPO_OWNER}/${REPO_NAME}${suffix}`;
    }

    // -------- items.js loader --------
    function decodeBase64Utf8(b64) {
        // GitHub returns base64 with line wraps.
        const clean = b64.replace(/\s+/g, '');
        const bin = atob(clean);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    }

    function encodeUtf8Base64(text) {
        const bytes = new TextEncoder().encode(text);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(bin);
    }

    async function loadExistingItems() {
        const res = await gh(repoPath(`/contents/items.js?ref=${BRANCH}`));
        const text = decodeBase64Utf8(res.content);
        existingIds = new Set();
        allItems = [];

        // Parse out IDs
        const re = /\bid:\s*['"]([^'"]+)['"]/g;
        let m;
        while ((m = re.exec(text)) !== null) existingIds.add(m[1]);

        // Parse full items by extracting each {...} object inside the items: [...] array.
        // Lightweight parser — splits each line that starts with `{ id: ...` and pulls out fields.
        const itemsBlock = text.match(/items:\s*\[([\s\S]*?)\n\s*\]/);
        if (itemsBlock) {
            const lines = itemsBlock[1].split('\n');
            for (const line of lines) {
                const item = parseItemLine(line);
                if (item) allItems.push(item);
            }
        }

        updateSlugPreview();
        renderManageList();
        return { text, sha: res.sha };
    }

    /**
     * Extracts simple key/value pairs from a single-line `{ id: '...', brand: '...', ... }`.
     * Handles both single and double-quoted strings; ignores nested braces (we don't have any).
     */
    function parseItemLine(line) {
        const trimmed = line.trim().replace(/,\s*$/, '');
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
        const inner = trimmed.slice(1, -1).trim();
        const item = {};
        // Match `key: 'value'`, `key: "value"`, `key: 123`, or `key: true`
        const re = /(\w+)\s*:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|(\d+)|(true|false))/g;
        let m;
        while ((m = re.exec(inner)) !== null) {
            const key = m[1];
            if (m[2] !== undefined) item[key] = m[2].replace(/\\(.)/g, '$1');
            else if (m[3] !== undefined) item[key] = m[3].replace(/\\(.)/g, '$1');
            else if (m[4] !== undefined) item[key] = parseInt(m[4], 10);
            else if (m[5] !== undefined) item[key] = m[5] === 'true';
        }
        return item.id ? item : null;
    }

    // -------- items.js editing --------
    function jsString(s) {
        // Single-quoted string with backslash-escaped quotes & backslashes.
        return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }

    function serializeItem(item) {
        const parts = [
            ['id',         jsString(item.id)],
            item.brand   ? ['brand', jsString(item.brand)] : null,
            ['name',       jsString(item.name)],
            ['category',   jsString(item.category)],
            ['size',       jsString(item.size)],
            ['image',      jsString(item.image)],
            item.image_alt ? ['image_alt', jsString(item.image_alt)] : null,
            ['link',       jsString(item.link)],
            ['popularity', String(item.popularity)],
            item.framed ? ['framed', 'true'] : null,
            item.bleed  ? ['bleed',  'true'] : null,
            ['added_on',   jsString(item.added_on)],
        ].filter(Boolean);
        return `{ ${parts.map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
    }

    function insertItem(itemsJsText, item) {
        const marker = /(items:\s*\[\s*\n)/;
        if (!marker.test(itemsJsText)) {
            throw new Error('Could not locate items array in items.js');
        }
        const line = `        ${serializeItem(item)},\n`;
        return itemsJsText.replace(marker, `$1${line}`);
    }

    function removeItemFromText(itemsJsText, id) {
        // Strip the entire line containing `id: 'xxx'`.
        const lines = itemsJsText.split('\n');
        const needle = `id: '${id}'`;
        const altNeedle = `id: "${id}"`;
        const out = lines.filter(line => !line.includes(needle) && !line.includes(altNeedle));
        if (out.length === lines.length) {
            throw new Error(`Could not find item ${id} in items.js`);
        }
        return out.join('\n');
    }

    function replaceItemInText(itemsJsText, id, newItem) {
        const lines = itemsJsText.split('\n');
        const needle = `id: '${id}'`;
        const altNeedle = `id: "${id}"`;
        let replaced = false;
        const out = lines.map(line => {
            if (replaced) return line;
            if (line.includes(needle) || line.includes(altNeedle)) {
                replaced = true;
                // Preserve indentation of original line.
                const indent = line.match(/^\s*/)[0];
                return `${indent}${serializeItem(newItem)},`;
            }
            return line;
        });
        if (!replaced) throw new Error(`Could not find item ${id} in items.js`);
        return out.join('\n');
    }

    // -------- Image pipeline --------
    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
            img.src = url;
        });
    }

    function encodeWebP(img, longEdge, quality) {
        const w = img.naturalWidth, h = img.naturalHeight;
        const longSide = Math.max(w, h);
        const ratio = longEdge < longSide ? longEdge / longSide : 1;
        const cw = Math.max(1, Math.round(w * ratio));
        const ch = Math.max(1, Math.round(h * ratio));
        const canvas = document.createElement('canvas');
        canvas.width  = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, cw, ch);
        return new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error('WebP encode failed (browser may not support image/webp)')),
                'image/webp',
                quality,
            );
        });
    }

    async function encodeAll(file) {
        const img = await loadImage(file);
        encoded.srcW = img.naturalWidth;
        encoded.srcH = img.naturalHeight;
        const [w800, w1600] = await Promise.all(
            WEBP_TARGETS.map(t => encodeWebP(img, t, WEBP_QUALITY))
        );
        encoded.blob800  = w800;
        encoded.blob1600 = w1600;
        return encoded;
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload  = () => {
                const s = r.result;
                const i = s.indexOf(',');
                resolve(s.slice(i + 1));
            };
            r.onerror = () => reject(new Error('Could not read blob'));
            r.readAsDataURL(blob);
        });
    }

    // -------- Drop / file picker --------
    stage.addEventListener('click', () => {
        // Only open the file picker when in empty state. Once a card is shown,
        // the user uses the Replace button to change images.
        if (!pickedFile) fileInput.click();
    });
    stage.addEventListener('keydown', (e) => {
        if (!pickedFile && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            fileInput.click();
        }
    });
    stage.addEventListener('dragover', (e) => {
        e.preventDefault();
        stage.classList.add('is-hover');
    });
    stage.addEventListener('dragleave', () => stage.classList.remove('is-hover'));
    stage.addEventListener('drop', (e) => {
        e.preventDefault();
        stage.classList.remove('is-hover');
        const f = e.dataTransfer?.files?.[0];
        if (f) handleFile(f);
    });

    fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (f) handleFile(f);
    });

    replaceBtn.addEventListener('click', () => fileInput.click());

    async function handleFile(file) {
        if (file.type !== 'image/png') {
            setStatus('Only PNG files are supported', 'error');
            return;
        }
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
            setStatus(`File too large (max ${MAX_FILE_MB} MB)`, 'error');
            return;
        }
        pickedFile = file;
        // Switch the stage from drop hint to live preview.
        if (previewURL) URL.revokeObjectURL(previewURL);
        previewURL = URL.createObjectURL(file);
        stage.classList.add('is-loaded');
        dropEmpty.hidden    = true;
        previewCard.hidden  = false;
        replaceBtn.hidden   = false;
        stageHint.textContent = 'Live preview — what publishes is what you see.';
        renderPreviewCard();

        setStatus('Encoding…');
        try {
            await encodeAll(file);
            srcInfo.textContent  = `${encoded.srcW}×${encoded.srcH} · ${fmtKB(file.size)}`;
            info800.textContent  = fmtKB(encoded.blob800.size);
            info1600.textContent = fmtKB(encoded.blob1600.size);
            encodedInfo.hidden = false;
            setStatus('Ready to publish.');
        } catch (err) {
            setStatus(err.message, 'error');
            pickedFile = null;
            encoded = { blob800: null, blob1600: null, srcW: 0, srcH: 0 };
        }
    }

    // -------- Live preview --------
    // Builds the same .card structure the public site uses, so style.css does
    // all the actual rendering work. The image src is the picked file's blob URL,
    // so no upload is required to see what publishes.
    function renderPreviewCard() {
        if (!pickedFile || !previewURL) return;
        const data = new FormData(itemForm);
        const name     = String(data.get('name') || '').trim();
        const brand    = String(data.get('brand') || '').trim();
        const category = String(data.get('category') || 'tech');
        const size     = data.get('size') === 'large' ? 'large' : 'small';
        const display  = String(data.get('display') || 'default');

        const flagAttrs = [];
        if (display === 'framed') flagAttrs.push('data-framed="true"');
        if (display === 'bleed')  flagAttrs.push('data-bleed="true"');

        const altText  = String(data.get('image_alt') || `${brand} ${name}`).trim();
        const fallback = brand || name || 'Untitled';

        previewCard.innerHTML = `
            <div class="card ${size}"
                 data-name="${esc(`${brand} ${name}`.trim())}"
                 data-category="${esc(category)}"
                 ${flagAttrs.join(' ')}>
                <div class="card-image has-image">
                    <span class="card-image-fallback">${esc(fallback)}</span>
                    <picture>
                        <img src="${previewURL}" alt="${esc(altText)}">
                    </picture>
                </div>
                <div class="card-meta">
                    <div class="card-text-link">
                        <span class="card-name">${esc(name) || '<em style="opacity:.4">Name…</em>'}</span>
                        ${brand ? `<span class="card-brand">${esc(brand)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // -------- Slug preview --------
    function updateSlugPreview() {
        const slug = makeSlug(brandInput.value, nameInput.value);
        slugPreview.textContent = `assets/items/${slug || '—'}.png`;
    }
    nameInput.addEventListener('input',  updateSlugPreview);
    brandInput.addEventListener('input', updateSlugPreview);

    // Any field change should refresh the live card preview + slug.
    function onFormChange() {
        if (pickedFile) renderPreviewCard();
        updateSlugPreview();
    }
    itemForm.addEventListener('input',  onFormChange);
    itemForm.addEventListener('change', onFormChange);

    // -------- Publish --------
    itemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!token) { showGate(); return; }

        const isEditing = !!editingId;
        // For new items, image is required. For edits, image is optional (keeps existing if not provided).
        if (!isEditing && (!pickedFile || !encoded.blob800 || !encoded.blob1600)) {
            setStatus('Pick an image first.', 'error');
            return;
        }

        const data = new FormData(itemForm);
        const name = String(data.get('name') || '').trim();
        if (!name) {
            setStatus('Name is required.', 'error');
            return;
        }

        const brand = String(data.get('brand') || '').trim();
        // For edits, keep the existing slug. For new, generate one.
        const slug = isEditing ? editingId : makeSlug(brand, name);
        const link = String(data.get('link') || '').trim()
            || `https://www.google.com/search?q=${encodeURIComponent(`${brand} ${name}`.trim())}`;
        const display = String(data.get('display') || 'default');

        // For edits, preserve added_on from original.
        const original = isEditing ? allItems.find(it => it.id === editingId) : null;
        const item = {
            id:        slug,
            brand,
            name,
            category:  String(data.get('category') || 'tech'),
            size:      data.get('size') === 'large' ? 'large' : 'small',
            image:     `assets/items/${slug}.png`,
            image_alt: String(data.get('image_alt') || '').trim(),
            link,
            popularity: Math.max(1, Math.min(100, parseInt(data.get('popularity'), 10) || 70)),
            framed:    display === 'framed',
            bleed:     display === 'bleed',
            added_on:  original?.added_on || todayISO(),
        };

        publishBtn.disabled = true;
        try {
            const result = isEditing
                ? await updateItem(item, !!pickedFile)
                : await publish(item);
            statusEl.innerHTML =
                `${isEditing ? 'Updated' : 'Published'}. ` +
                `<a href="${esc(result.commit)}" target="_blank" rel="noopener">View commit ↗</a>` +
                ` · Live at ` +
                `<a href="${esc(result.site)}" target="_blank" rel="noopener">${esc(result.site)}</a>` +
                ` in ~1 min.`;
            statusEl.classList.remove('is-error');
            statusEl.classList.add('is-success');
            resetForm();
            await loadExistingItems();
        } catch (err) {
            if (err.isAuth) {
                localStorage.removeItem(TOKEN_KEY);
                token = '';
                showGate('Token rejected. Paste a fresh one — your draft is preserved.');
            } else {
                setStatus(err.message, 'error');
            }
        } finally {
            publishBtn.disabled = false;
        }
    });

    function resetForm() {
        itemForm.reset();
        pickedFile = null;
        encoded = { blob800: null, blob1600: null, srcW: 0, srcH: 0 };
        if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
        previewCard.innerHTML = '';
        previewCard.hidden = true;
        replaceBtn.hidden  = true;
        dropEmpty.hidden   = false;
        stage.classList.remove('is-loaded');
        encodedInfo.hidden = true;
        editingId = null;
        if (publishBtn) publishBtn.textContent = 'Publish';
        const cancelBtn = document.getElementById('cancelEditBtn');
        if (cancelBtn) cancelBtn.hidden = true;
        updateSlugPreview();
    }

    /**
     * Atomic publish via the Git Data API.
     * Steps: ref -> commit -> 4 blobs -> tree -> commit -> ref.
     */
    async function publish(item) {
        setStatus('Reading branch…');
        const ref = await gh(repoPath(`/git/refs/heads/${BRANCH}`));
        const parentSha = ref.object.sha;
        const parentCommit = await gh(repoPath(`/git/commits/${parentSha}`));
        const baseTreeSha = parentCommit.tree.sha;

        setStatus('Reading items.js…');
        const itemsRes = await gh(repoPath(`/contents/items.js?ref=${BRANCH}`));
        const oldText  = decodeBase64Utf8(itemsRes.content);
        const newText  = insertItem(oldText, item);

        setStatus('Uploading image (PNG)…');
        const pngSha = await uploadBlob(await blobToBase64(pickedFile));

        setStatus('Uploading WebP variants…');
        const [w800Sha, w1600Sha] = await Promise.all([
            blobToBase64(encoded.blob800).then(uploadBlob),
            blobToBase64(encoded.blob1600).then(uploadBlob),
        ]);

        setStatus('Updating items.js…');
        const itemsSha = await uploadBlob(encodeUtf8Base64(newText));

        setStatus('Building tree…');
        const tree = await gh(repoPath('/git/trees'), {
            method: 'POST',
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: [
                    { path: `assets/items/${item.id}.png`,       mode: '100644', type: 'blob', sha: pngSha },
                    { path: `assets/items/${item.id}-800.webp`,  mode: '100644', type: 'blob', sha: w800Sha },
                    { path: `assets/items/${item.id}-1600.webp`, mode: '100644', type: 'blob', sha: w1600Sha },
                    { path: 'items.js',                          mode: '100644', type: 'blob', sha: itemsSha },
                ],
            }),
        });

        setStatus('Committing…');
        const commitMsg = `Add ${item.brand ? item.brand + ' ' : ''}${item.name}`.trim();
        const commit = await gh(repoPath('/git/commits'), {
            method: 'POST',
            body: JSON.stringify({
                message: commitMsg,
                tree:    tree.sha,
                parents: [parentSha],
            }),
        });

        setStatus('Advancing branch…');
        await gh(repoPath(`/git/refs/heads/${BRANCH}`), {
            method: 'PATCH',
            body: JSON.stringify({ sha: commit.sha, force: false }),
        });

        // Track new id locally so subsequent publishes in this session dedup.
        existingIds.add(item.id);

        return {
            commit: commit.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${commit.sha}`,
            site:   `${SITE_URL}#${item.category}`,
        };
    }

    async function uploadBlob(base64Content) {
        const res = await gh(repoPath('/git/blobs'), {
            method: 'POST',
            body: JSON.stringify({ content: base64Content, encoding: 'base64' }),
        });
        return res.sha;
    }

    /**
     * Update an existing item. If `replaceImage` is true, also re-uploads the 3 image variants.
     * Otherwise only updates items.js.
     */
    async function updateItem(item, replaceImage) {
        setStatus('Reading branch…');
        const ref = await gh(repoPath(`/git/refs/heads/${BRANCH}`));
        const parentSha = ref.object.sha;
        const parentCommit = await gh(repoPath(`/git/commits/${parentSha}`));
        const baseTreeSha = parentCommit.tree.sha;

        setStatus('Reading items.js…');
        const itemsRes = await gh(repoPath(`/contents/items.js?ref=${BRANCH}`));
        const oldText  = decodeBase64Utf8(itemsRes.content);
        const newText  = replaceItemInText(oldText, item.id, item);

        const treeEntries = [];

        if (replaceImage) {
            setStatus('Uploading image (PNG)…');
            const pngSha = await uploadBlob(await blobToBase64(pickedFile));
            setStatus('Uploading WebP variants…');
            const [w800Sha, w1600Sha] = await Promise.all([
                blobToBase64(encoded.blob800).then(uploadBlob),
                blobToBase64(encoded.blob1600).then(uploadBlob),
            ]);
            treeEntries.push(
                { path: `assets/items/${item.id}.png`,       mode: '100644', type: 'blob', sha: pngSha },
                { path: `assets/items/${item.id}-800.webp`,  mode: '100644', type: 'blob', sha: w800Sha },
                { path: `assets/items/${item.id}-1600.webp`, mode: '100644', type: 'blob', sha: w1600Sha },
            );
        }

        setStatus('Updating items.js…');
        const itemsSha = await uploadBlob(encodeUtf8Base64(newText));
        treeEntries.push({ path: 'items.js', mode: '100644', type: 'blob', sha: itemsSha });

        setStatus('Building tree…');
        const tree = await gh(repoPath('/git/trees'), {
            method: 'POST',
            body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
        });

        setStatus('Committing…');
        const msg = `Update ${item.brand ? item.brand + ' ' : ''}${item.name}`.trim();
        const commit = await gh(repoPath('/git/commits'), {
            method: 'POST',
            body: JSON.stringify({ message: msg, tree: tree.sha, parents: [parentSha] }),
        });

        setStatus('Advancing branch…');
        await gh(repoPath(`/git/refs/heads/${BRANCH}`), {
            method: 'PATCH',
            body: JSON.stringify({ sha: commit.sha, force: false }),
        });

        return {
            commit: commit.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${commit.sha}`,
            site:   `${SITE_URL}#${item.category}`,
        };
    }

    /**
     * Delete an item. Removes the line from items.js and deletes the 3 image files
     * (PNG + 2 WebP) in a single atomic commit.
     */
    async function deleteItemRemote(item) {
        const ref = await gh(repoPath(`/git/refs/heads/${BRANCH}`));
        const parentSha = ref.object.sha;
        const parentCommit = await gh(repoPath(`/git/commits/${parentSha}`));
        const baseTreeSha = parentCommit.tree.sha;

        const itemsRes = await gh(repoPath(`/contents/items.js?ref=${BRANCH}`));
        const oldText  = decodeBase64Utf8(itemsRes.content);
        const newText  = removeItemFromText(oldText, item.id);
        const itemsSha = await uploadBlob(encodeUtf8Base64(newText));

        // sha: null in tree update = delete the file at that path.
        const tree = await gh(repoPath('/git/trees'), {
            method: 'POST',
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: [
                    { path: `assets/items/${item.id}.png`,       mode: '100644', type: 'blob', sha: null },
                    { path: `assets/items/${item.id}-800.webp`,  mode: '100644', type: 'blob', sha: null },
                    { path: `assets/items/${item.id}-1600.webp`, mode: '100644', type: 'blob', sha: null },
                    { path: 'items.js',                          mode: '100644', type: 'blob', sha: itemsSha },
                ],
            }),
        });

        const msg = `Delete ${item.brand ? item.brand + ' ' : ''}${item.name}`.trim();
        const commit = await gh(repoPath('/git/commits'), {
            method: 'POST',
            body: JSON.stringify({ message: msg, tree: tree.sha, parents: [parentSha] }),
        });

        await gh(repoPath(`/git/refs/heads/${BRANCH}`), {
            method: 'PATCH',
            body: JSON.stringify({ sha: commit.sha, force: false }),
        });

        existingIds.delete(item.id);
        return commit.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${commit.sha}`;
    }

    // -------- Tabs --------
    const tabAddBtn    = $('tabAddBtn');
    const tabManageBtn = $('tabManageBtn');
    const addPanel     = $('addPanel');
    const managePanel  = $('managePanel');
    const manageList   = $('manageList');
    const manageSearch = $('manageSearch');
    const manageCount  = $('manageCount');
    const manageStatus = $('manageStatus');
    const cancelEditBtn = $('cancelEditBtn');

    function switchTab(name) {
        const isAdd = name === 'add';
        tabAddBtn.classList.toggle('is-active', isAdd);
        tabAddBtn.setAttribute('aria-selected', isAdd ? 'true' : 'false');
        tabManageBtn.classList.toggle('is-active', !isAdd);
        tabManageBtn.setAttribute('aria-selected', !isAdd ? 'true' : 'false');
        addPanel.classList.toggle('is-active', isAdd);
        addPanel.hidden = !isAdd;
        managePanel.classList.toggle('is-active', !isAdd);
        managePanel.hidden = isAdd;
    }

    tabAddBtn.addEventListener('click',    () => switchTab('add'));
    tabManageBtn.addEventListener('click', () => switchTab('manage'));

    // -------- Manage list rendering --------
    function renderManageList() {
        if (!manageList) return;
        const q = (manageSearch.value || '').trim().toLowerCase();
        const filtered = !q ? allItems : allItems.filter(it => {
            const hay = `${it.name || ''} ${it.brand || ''} ${it.category || ''}`.toLowerCase();
            return hay.includes(q);
        });

        manageCount.textContent = filtered.length === allItems.length
            ? `${allItems.length} products`
            : `${filtered.length} of ${allItems.length}`;

        if (!filtered.length) {
            manageList.innerHTML = `<div class="admin-manage-empty">${q ? 'No matches.' : 'No products yet.'}</div>`;
            return;
        }

        manageList.innerHTML = filtered.map(it => {
            const sub = [it.brand, it.category].filter(Boolean).join(' · ');
            const thumb = it.image ? `<img class="admin-manage-thumb" src="${esc(it.image)}" alt="" loading="lazy">` : '';
            return `
                <div class="admin-manage-item">
                    ${thumb}
                    <div class="admin-manage-info">
                        <div class="admin-manage-name">${esc(it.name || '')}</div>
                        <div class="admin-manage-sub">${esc(sub)}</div>
                    </div>
                    <div class="admin-manage-actions">
                        <button type="button" class="admin-icon-btn" data-edit="${esc(it.id)}">Edit</button>
                        <button type="button" class="admin-icon-btn is-danger" data-delete="${esc(it.id)}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    manageSearch?.addEventListener('input', renderManageList);

    manageList?.addEventListener('click', async (e) => {
        const editBtn   = e.target.closest('[data-edit]');
        const deleteBtn = e.target.closest('[data-delete]');

        if (editBtn) {
            const id = editBtn.getAttribute('data-edit');
            const item = allItems.find(it => it.id === id);
            if (item) enterEditMode(item);
            return;
        }

        if (deleteBtn) {
            const id = deleteBtn.getAttribute('data-delete');
            const item = allItems.find(it => it.id === id);
            if (!item) return;
            const label = `${item.brand ? item.brand + ' ' : ''}${item.name}`;
            if (!confirm(`Delete "${label}"?\n\nThis removes the entry and the 3 image files in one commit.`)) return;

            deleteBtn.disabled = true;
            manageStatus.textContent = `Deleting ${label}…`;
            manageStatus.classList.remove('is-success', 'is-error');
            try {
                const commitURL = await deleteItemRemote(item);
                manageStatus.innerHTML = `Deleted "${esc(label)}". <a href="${esc(commitURL)}" target="_blank" rel="noopener">View commit ↗</a>`;
                manageStatus.classList.add('is-success');
                await loadExistingItems();
            } catch (err) {
                if (err.isAuth) {
                    localStorage.removeItem(TOKEN_KEY);
                    token = '';
                    showGate('Token rejected. Paste a fresh one.');
                } else {
                    manageStatus.textContent = err.message;
                    manageStatus.classList.add('is-error');
                }
                deleteBtn.disabled = false;
            }
        }
    });

    // -------- Edit mode --------
    function enterEditMode(item) {
        editingId = item.id;
        switchTab('add');
        // Populate form fields
        nameInput.value  = item.name || '';
        brandInput.value = item.brand || '';
        $('linkInput').value     = item.link || '';
        $('altInput').value      = item.image_alt || '';
        $('popInput').value      = item.popularity ?? 70;
        $('categoryInput').value = item.category || 'tech';

        // Radios
        const sizeVal = item.size === 'large' ? 'large' : 'small';
        document.querySelector(`input[name="size"][value="${sizeVal}"]`).checked = true;
        const display = item.bleed ? 'bleed' : (item.framed ? 'framed' : 'default');
        document.querySelector(`input[name="display"][value="${display}"]`).checked = true;

        // Update UI affordances
        publishBtn.textContent = 'Update';
        cancelEditBtn.hidden = false;
        slugPreview.textContent = `editing ${item.id}`;
        setStatus(`Editing "${item.name}". Replace the image to update it, or just edit fields and Update.`);

        // Show existing image as a preview thumbnail (visual reference only).
        if (item.image) {
            previewCard.hidden = false;
            previewCard.innerHTML = `
                <div class="card ${item.size || 'small'}">
                    <div class="card-image has-image">
                        <picture>
                            <img src="${esc(item.image)}" alt="${esc(item.image_alt || item.name || '')}">
                        </picture>
                    </div>
                    <div class="card-meta">
                        <div class="card-text-link">
                            <span class="card-name">${esc(item.name || '')}</span>
                            ${item.brand ? `<span class="card-brand">${esc(item.brand)}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
            dropEmpty.hidden = true;
            replaceBtn.hidden = false;
            stage.classList.add('is-loaded');
            stageHint.textContent = 'Showing current image. Replace to update, or leave as-is.';
        }
    }

    function exitEditMode() {
        editingId = null;
        publishBtn.textContent = 'Publish';
        cancelEditBtn.hidden = true;
        resetForm();
    }

    cancelEditBtn?.addEventListener('click', exitEditMode);
})();
