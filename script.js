(function () {
    'use strict';

    const data = window.CURATED_DATA;
    if (!data) return;

    const grid       = document.getElementById('grid');
    const filterList = document.getElementById('filterList');
    const countEl    = document.getElementById('productCount');
    const validCats  = new Set(data.categories.map(c => c.id));

    const COPY_RESET_MS = 1500;

    const COPY_ICON = `
        <svg class="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor"
             stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5.5" y="5.5" width="9" height="9" rx="1.5"/>
            <path d="M11 2.5H3a1 1 0 0 0-1 1V11"/>
        </svg>`;

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

    // No two items of the same category appear within `window` positions,
    // so a category never repeats within one row of the 4-col grid.
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

    function renderFilters() {
        const all = [{ id: 'all', label: 'all' }, ...data.categories];
        filterList.innerHTML = all.map(c => {
            const cls = c.id === activeCategory ? 'filter-link active' : 'filter-link';
            return `<button class="${cls}" type="button" data-cat="${escape(c.id)}">${escape(c.label)}</button>`;
        }).join('');
    }

    function renderCard(item) {
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

        const imgTag = item.image?.trim()
            ? `<img src="${escape(item.image)}" alt="${escape(item.image_alt || query)}"
                   loading="lazy" onload="this.parentElement.classList.add('has-image')">`
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

    function renderGrid() {
        const visible = activeCategory === 'all'
            ? items
            : items.filter(i => i.category === activeCategory);

        countEl.textContent = `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`;
        grid.innerHTML = visible.map(renderCard).join('');
    }

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
        renderGrid();
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
        renderGrid();
    });

    // Set SUBMIT_ENDPOINT to a Formspree/Netlify/Basin URL to POST directly;
    // otherwise submissions open the user's mail client to SUBMIT_TO.
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
            const data = new FormData(submitForm);
            const fields = Object.fromEntries(data.entries());

            if (SUBMIT_ENDPOINT) {
                try {
                    const res = await fetch(SUBMIT_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json' },
                        body: data,
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
    renderGrid();
})();
