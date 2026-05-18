(function () {
    'use strict';

    const data = window.CURATED_DATA;
    if (!data) return;

    const grid       = document.getElementById('grid');
    const filterList = document.getElementById('filterList');
    const countEl    = document.getElementById('productCount');
    const validCats  = new Set(data.categories.map(c => c.id));

    const COPY_RESET_MS = 1500;
    const INITIAL_CHUNK = 16;
    const CHUNK_SIZE    = 24;

    const COPY_ICON = `
        <svg class="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor"
             stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5.5" y="5.5" width="9" height="9" rx="1.5"/>
            <path d="M11 2.5H3a1 1 0 0 0-1 1V11"/>
        </svg>`;

    const IMG_SIZES =
        '(max-width: 419px) 100vw, (max-width: 599px) 50vw, (max-width: 1024px) 50vw, 25vw';

    const escape = (s) => String(s)
        .replaceAll('&',  '&amp;')
        .replaceAll('<',  '&lt;')
        .replaceAll('>',  '&gt;')
        .replaceAll('"',  '&quot;')
        .replaceAll("'",  '&#39;');

    const readCategoryFromHash = () => {
        const h = location.hash.slice(1);
        return validCats.has(h) ? h : 'all';
    };

    function shuffleMixed(arr, window = 4) {
        const remaining = arr.slice();
        const out = [];
        while (remaining.length) {
            const recent = new Set(out.slice(-window).map(i => i.category));
            const eligible = [];
            for (let i = 0; i < remaining.length; i++) {
                if (!recent.has(remaining[i].category)) eligible.push(i);
            }
            const pool = eligible.length ? eligible : remaining.map((_, i) => i);
            const idx = pool[Math.floor(Math.random() * pool.length)];
            out.push(remaining.splice(idx, 1)[0]);
        }
        return out;
    }

    function legacyCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch {}
        ta.remove();
    }

    function copyToClipboard(text, onDone) {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(onDone).catch(() => {
                legacyCopy(text);
                onDone();
            });
        } else {
            legacyCopy(text);
            onDone();
        }
    }

    const items = shuffleMixed(data.items);
    let activeCategory = readCategoryFromHash();
    let gridBuilt = false;

    function renderFilters() {
        const all = [{ id: 'all', label: 'all' }, ...data.categories];
        filterList.innerHTML = all.map(c => {
            const cls = c.id === activeCategory ? 'filter-link active' : 'filter-link';
            return `<button class="${cls}" type="button" data-cat="${escape(c.id)}">${escape(c.label)}</button>`;
        }).join('');
    }

    function renderCard(item, eager) {
        const brand = item.brand || '';
        const name  = item.name;
        const size  = item.size === 'large' ? 'large' : 'small';
        const query = brand ? `${brand} ${name}` : name;
        const url   = item.link || `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        const fallback = brand || name;
        const queryEsc = escape(query);

        const flags = [
            item.framed && 'data-framed="true"',
            item.bleed  && 'data-bleed="true"',
        ].filter(Boolean).join(' ');

        const loadAttr = eager
            ? 'loading="eager" fetchpriority="high" decoding="async"'
            : 'loading="lazy" decoding="async"';

        const src = item.image?.trim();
        const webp = src?.replace(/\.png$/i, '.webp');
        const imgTag = src
            ? `<picture>
                    <source type="image/webp" srcset="${escape(webp)}">
                    <img src="${escape(src)}" alt="${escape(item.image_alt || query)}"
                         width="800" height="800" sizes="${IMG_SIZES}" ${loadAttr}>
               </picture>`
            : '';

        return `
            <div class="card ${size}" data-name="${queryEsc}"
                 data-category="${escape(item.category || '')}" ${flags}>
                <a class="card-link" href="${url}" target="_blank" rel="noopener noreferrer">
                    <div class="card-image">
                        <span class="card-image-fallback">${escape(fallback)}</span>
                        ${imgTag}
                    </div>
                </a>
                <div class="card-meta">
                    <a class="card-link card-text-link" href="${url}" target="_blank" rel="noopener noreferrer">
                        <span class="card-name">${escape(name)}</span>
                        ${brand ? `<span class="card-brand">${escape(brand)}</span>` : ''}
                    </a>
                    <button class="card-copy" type="button"
                            data-copy="${queryEsc}" aria-label="Copy ${queryEsc}">
                        ${COPY_ICON}
                        <span class="card-copy-status">copied</span>
                    </button>
                </div>
            </div>
        `;
    }

    function cardMatchesFilter(category) {
        return activeCategory === 'all' || category === activeCategory;
    }

    function updateCount() {
        const n = activeCategory === 'all'
            ? items.length
            : items.filter(i => i.category === activeCategory).length;
        countEl.textContent = `${n} ${n === 1 ? 'item' : 'items'}`;
    }

    function applyFilter() {
        if (!gridBuilt) return;
        grid.querySelectorAll('.card').forEach(card => {
            const show = cardMatchesFilter(card.dataset.category);
            card.hidden = !show;
        });
        updateCount();
    }

    function appendCards(slice, startIndex) {
        const html = slice.map((item, i) =>
            renderCard(item, startIndex + i < INITIAL_CHUNK)
        ).join('');
        grid.insertAdjacentHTML('beforeend', html);
    }

    function buildGrid() {
        if (gridBuilt) {
            applyFilter();
            return;
        }

        let index = 0;
        const first = items.slice(0, INITIAL_CHUNK);
        appendCards(first, 0);
        index = first.length;
        gridBuilt = true;
        applyFilter();

        const rest = items.slice(index);
        if (!rest.length) return;

        const schedule = window.requestIdleCallback
            ? (cb) => requestIdleCallback(cb, { timeout: 1200 })
            : (cb) => setTimeout(cb, 0);

        function pump() {
            const chunk = rest.splice(0, CHUNK_SIZE);
            if (!chunk.length) return;
            appendCards(chunk, index);
            index += chunk.length;
            applyFilter();
            if (rest.length) schedule(pump);
        }

        schedule(pump);
    }

    grid.addEventListener('load', e => {
        if (e.target.tagName !== 'IMG') return;
        e.target.closest('.card-image')?.classList.add('has-image');
    }, true);

    filterList.addEventListener('click', e => {
        const btn = e.target.closest('.filter-link');
        if (!btn) return;
        const next = btn.dataset.cat;
        if (next === activeCategory) return;
        activeCategory = next;
        const newUrl = next === 'all'
            ? location.pathname + location.search
            : '#' + next;
        history.replaceState(null, '', newUrl);
        renderFilters();
        applyFilter();
    });

    grid.addEventListener('click', e => {
        const copyBtn = e.target.closest('.card-copy');
        if (copyBtn) {
            e.preventDefault();
            e.stopPropagation();
            copyToClipboard(copyBtn.dataset.copy || '', () => {
                copyBtn.classList.add('copied');
                clearTimeout(copyBtn._resetTimer);
                copyBtn._resetTimer = setTimeout(
                    () => copyBtn.classList.remove('copied'), COPY_RESET_MS
                );
            });
            return;
        }
        const link = e.target.closest('.card-link');
        if (link && window.plausible) {
            const card = link.closest('.card');
            if (card) plausible('Item Click', { props: { name: card.dataset.name } });
        }
    });

    window.addEventListener('hashchange', () => {
        activeCategory = readCategoryFromHash();
        renderFilters();
        applyFilter();
    });

    const SUBMIT_TO       = 'submissions@johnyvino.com';
    const SUBMIT_ENDPOINT = '';

    const submitButton = document.getElementById('submitButton');
    const submitModal  = document.getElementById('submitModal');
    const submitForm   = document.getElementById('submitForm');

    if (submitButton && submitModal && submitForm) {
        const openModal = () => {
            submitModal.classList.add('open');
            submitModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            setTimeout(() => submitForm.querySelector('input')?.focus(), 80);
        };
        const closeModal = () => {
            submitModal.classList.remove('open');
            submitModal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        };

        submitButton.addEventListener('click', openModal);
        submitModal.addEventListener('click', e => {
            if (e.target.dataset.close !== undefined) closeModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && submitModal.classList.contains('open')) closeModal();
        });

        submitForm.addEventListener('submit', async e => {
            e.preventDefault();
            const formData = new FormData(submitForm);
            const fields = Object.fromEntries(formData.entries());

            if (SUBMIT_ENDPOINT) {
                try {
                    const res = await fetch(SUBMIT_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json' },
                        body: formData,
                    });
                    if (res.ok) {
                        submitForm.reset();
                        closeModal();
                        alert('Thanks for the submission.');
                    } else {
                        alert('Submission failed. Please try again later.');
                    }
                } catch {
                    alert('Network error. Please try again.');
                }
                return;
            }

            const subject = `Submission: ${fields.name || ''} by ${fields.brand || ''}`;
            const body = [
                `Name:     ${fields.name || ''}`,
                `Brand:    ${fields.brand || ''}`,
                `Link:     ${fields.link || ''}`,
                `Category: ${fields.category || '—'}`,
                '',
                `Why is it well designed:`,
                fields.why || '—',
                '',
                `From: ${fields.from || 'anonymous'}`,
            ].join('\n');
            window.location.href =
                `mailto:${SUBMIT_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            submitForm.reset();
            closeModal();
        });
    }

    renderFilters();
    buildGrid();
})();
