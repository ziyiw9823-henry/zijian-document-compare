(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const editor = $('#finalEditor');
  const reviewStage = $('#reviewStage');
  const diffList = $('#diffList');
  const docs = {
    a: { side: 'a', surface: $('#editorA'), text: $('#textA'), file: $('#fileA'), card: $('.doc-a'), count: $('#countA'), name: $('#fileNameA'), state: $('#editStateA') },
    b: { side: 'b', surface: $('#editorB'), text: $('#textB'), file: $('#fileB'), card: $('.doc-b'), count: $('#countB'), name: $('#fileNameB'), state: $('#editStateB') }
  };
  let blocks = [];
  let decisions = {};
  let saveTimer;
  let toastTimer;

  function tokenize(text) {
    if (!text) return [];
    if (window.Intl && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
      return Array.from(segmenter.segment(text), item => item.segment);
    }
    return text.match(/[\u3400-\u9fff]|[A-Za-z0-9]+(?:['’][A-Za-z]+)?|\s+|[^\s]/g) || [];
  }

  function myers(a, b) {
    const n = a.length, m = b.length, max = n + m;
    const v = new Map([[1, 0]]), trace = [];
    for (let d = 0; d <= max; d++) {
      trace.push(new Map(v));
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) x = v.get(k + 1) ?? 0;
        else x = (v.get(k - 1) ?? 0) + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v.set(k, x);
        if (x >= n && y >= m) return backtrack(trace, a, b);
      }
    }
    return [];
  }

  function backtrack(trace, a, b) {
    let x = a.length, y = b.length;
    const edits = [];
    for (let d = trace.length - 1; d >= 0; d--) {
      const v = trace[d], k = x - y;
      const prevK = (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) ? k + 1 : k - 1;
      const prevX = v.get(prevK) ?? 0, prevY = prevX - prevK;
      while (x > prevX && y > prevY) { edits.push({ type: 'equal', value: a[--x] }); y--; }
      if (d === 0) break;
      if (x === prevX) edits.push({ type: 'insert', value: b[--y] });
      else edits.push({ type: 'delete', value: a[--x] });
    }
    return edits.reverse();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clearHighlights(surface) {
    surface.querySelectorAll('mark.inline-diff').forEach(mark => mark.replaceWith(...mark.childNodes));
    surface.normalize();
  }

  function buildTextMap(surface) {
    const nodes = [];
    let text = '';
    const blockTags = new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','LI','TR','TABLE','UL','OL']);
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue || '';
        if (value) {
          const start = text.length;
          text += value;
          nodes.push({ node, start, end: text.length });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (['SCRIPT','STYLE','NOSCRIPT','CANVAS','SVG'].includes(node.tagName)) return;
      if (node.tagName === 'BR') { text += '\n'; return; }
      Array.from(node.childNodes).forEach(walk);
      if (blockTags.has(node.tagName) && text && !text.endsWith('\n')) text += '\n';
    }
    Array.from(surface.childNodes).forEach(walk);
    return { text: text.replace(/\n{3,}/g, '\n\n'), nodes };
  }

  function rangesFromEdits(edits) {
    const a = [], b = [];
    let posA = 0, posB = 0;
    edits.forEach(edit => {
      const length = edit.value.length;
      if (edit.type === 'equal') { posA += length; posB += length; }
      if (edit.type === 'delete') { a.push({ start: posA, end: posA + length }); posA += length; }
      if (edit.type === 'insert') { b.push({ start: posB, end: posB + length }); posB += length; }
    });
    return { a, b };
  }

  function applyRanges(map, ranges, className) {
    map.nodes.forEach(record => {
      const hits = ranges
        .map(range => ({ start: Math.max(range.start, record.start) - record.start, end: Math.min(range.end, record.end) - record.start }))
        .filter(range => range.start < range.end)
        .sort((x, y) => x.start - y.start);
      if (!hits.length || !record.node.isConnected) return;
      const value = record.node.nodeValue || '';
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      hits.forEach(hit => {
        if (hit.start > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, hit.start)));
        fragment.appendChild(el('mark', 'inline-diff ' + className, value.slice(hit.start, hit.end)));
        cursor = hit.end;
      });
      if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
      record.node.replaceWith(fragment);
    });
  }

  function buildBlocks(edits) {
    const result = [];
    let current = null;
    edits.forEach(edit => {
      const kind = edit.type === 'equal' ? 'equal' : 'diff';
      if (!current || current.kind !== kind) {
        current = { id: 'block-' + result.length, kind, a: '', b: '' };
        result.push(current);
      }
      if (edit.type === 'equal') { current.a += edit.value; current.b += edit.value; }
      if (edit.type === 'delete') current.a += edit.value;
      if (edit.type === 'insert') current.b += edit.value;
    });
    return result.filter(item => item.a || item.b);
  }

  function renderComparison() {
    decisions = {};
    clearHighlights(docs.a.surface);
    clearHighlights(docs.b.surface);
    const mapA = buildTextMap(docs.a.surface);
    const mapB = buildTextMap(docs.b.surface);
    docs.a.text.value = mapA.text;
    docs.b.text.value = mapB.text;
    const tokensA = tokenize(mapA.text), tokensB = tokenize(mapB.text);
    if (!tokensA.length || !tokensB.length) return toast('请先拖入两份文档');
    if (tokensA.length + tokensB.length > 50000) return toast('文档较长，请先拆分后比较');
    const edits = myers(tokensA, tokensB);
    const ranges = rangesFromEdits(edits);
    applyRanges(mapA, ranges.a, 'diff-a');
    applyRanges(mapB, ranges.b, 'diff-b');
    blocks = buildBlocks(edits);
    renderReview();
    ['a','b'].forEach(side => {
      docs[side].card.classList.add('compared');
      docs[side].card.classList.remove('dirty');
      docs[side].state.textContent = '差异已高亮';
    });
    reviewStage.hidden = false;
    updateCounts();
    saveLocal();
    const total = blocks.filter(item => item.kind === 'diff').length;
    toast(total ? '已在两份文档中高亮 ' + total + ' 处差异' : '两份文档内容一致');
  }

  function renderReview() {
    diffList.innerHTML = '';
    editor.innerHTML = '';
    let diffNo = 0;
    blocks.forEach(block => {
      const span = el('span');
      span.dataset.blockId = block.id;
      span.textContent = block.kind === 'equal' ? block.a : (block.b || block.a);
      editor.appendChild(span);
      if (block.kind === 'equal') return;
      diffNo++;
      const card = el('article', 'diff-card');
      const texts = el('div', 'diff-texts');
      const left = el('div', 'diff-text');
      const right = el('div', 'diff-text');
      if (block.a) left.appendChild(el('mark', '', block.a)); else left.appendChild(el('span', 'empty-text', '（此处为空）'));
      if (block.b) right.appendChild(el('mark', '', block.b)); else right.appendChild(el('span', 'empty-text', '（此处为空）'));
      texts.append(left, right);
      const bar = el('div', 'decision-bar');
      bar.appendChild(el('span', '', '差异 ' + String(diffNo).padStart(2, '0') + ' · 选择满意稿内容'));
      [['a','采用 A'],['b','采用 B'],['both','都保留'],['none','都删除']].forEach(([choice, label]) => {
        const button = el('button', 'choice', label);
        button.dataset.choice = choice;
        button.addEventListener('click', () => choose(block, choice, card));
        bar.appendChild(button);
      });
      card.append(texts, bar);
      diffList.appendChild(card);
    });
    $('#diffCount').textContent = diffNo;
    $('#resolvedCount').textContent = '0';
    $('#allDone').hidden = true;
    updateFinalCount();
  }

  function choose(block, choice, card) {
    decisions[block.id] = choice;
    card.querySelectorAll('.choice').forEach(button => button.classList.toggle('selected', button.dataset.choice === choice));
    card.classList.add('resolved');
    const target = editor.querySelector('[data-block-id="' + block.id + '"]');
    if (target) {
      target.textContent = choice === 'a' ? block.a : choice === 'b' ? block.b : choice === 'both' ? block.a + block.b : '';
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    }
    const resolved = Object.keys(decisions).length;
    const total = blocks.filter(item => item.kind === 'diff').length;
    $('#resolvedCount').textContent = resolved;
    $('#allDone').hidden = resolved !== total;
    updateFinalCount();
    saveLocal();
  }

  function syncDocument(side, markDirty) {
    const doc = docs[side];
    const map = buildTextMap(doc.surface);
    doc.text.value = map.text.trim();
    doc.count.textContent = doc.text.value.length + ' 字';
    doc.card.classList.toggle('doc-loaded', Boolean(doc.text.value));
    if (markDirty && doc.text.value) {
      doc.card.classList.add('dirty');
      doc.state.textContent = '已修改';
    }
  }

  function updateCounts() {
    syncDocument('a', false);
    syncDocument('b', false);
  }

  function renderPlainDocument(surface, text, className) {
    surface.innerHTML = '';
    const page = el('article', className || 'text-document');
    String(text || '').split(/\n{2,}/).forEach(part => page.appendChild(el('p', '', part.replace(/\n/g, ' '))));
    surface.appendChild(page);
  }

  function sanitizeHtml(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(node => node.remove());
    parsed.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes).forEach(attribute => {
        if (/^on/i.test(attribute.name) || /javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
      });
    });
    return parsed.body.innerHTML;
  }

  async function renderDocx(file, surface) {
    const buffer = await file.arrayBuffer();
    if (window.docx && window.docx.renderAsync) {
      surface.innerHTML = '';
      await window.docx.renderAsync(buffer, surface, surface, {
        className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false,
        ignoreFonts: false, breakPages: true, useBase64URL: true, renderHeaders: true,
        renderFooters: true, renderFootnotes: true
      });
      return;
    }
    if (!window.mammoth) throw new Error('Word 渲染组件未就绪');
    const result = await window.mammoth.convertToHtml({ arrayBuffer: buffer });
    surface.innerHTML = '<article class="text-document">' + sanitizeHtml(result.value) + '</article>';
  }

  async function renderPdf(file, surface) {
    await window.documentReadersReady;
    if (!window.pdfjsLib) throw new Error('PDF 渲染组件未就绪');
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    surface.innerHTML = '';
    const container = el('div', 'pdf-document');
    let foundText = false;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const lines = [];
      let lastY = null, line = [];
      content.items.forEach(item => {
        const y = Math.round(item.transform?.[5] || 0);
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line.join(' ').trim()); line = []; }
        line.push(item.str);
        lastY = y;
      });
      if (line.length) lines.push(line.join(' ').trim());
      const pageNode = el('article', 'paper-page pdf-page');
      pageNode.dataset.pageLabel = 'PDF · PAGE ' + number;
      lines.filter(Boolean).forEach(value => { pageNode.appendChild(el('p', '', value)); foundText = true; });
      container.appendChild(pageNode);
    }
    if (!foundText) throw new Error('这是扫描版 PDF，请先 OCR 后再比较');
    surface.appendChild(container);
  }

  async function loadFile(file, side) {
    if (!file) return;
    const doc = docs[side];
    const label = doc.card.querySelector('.file-label');
    label.classList.add('loading');
    doc.card.classList.remove('dragging');
    toast('正在打开 ' + file.name + '…');
    try {
      clearHighlights(doc.surface);
      if (/\.docx$/i.test(file.name)) await renderDocx(file, doc.surface);
      else if (/\.pdf$/i.test(file.name)) await renderPdf(file, doc.surface);
      else if (/\.html?$/i.test(file.name)) doc.surface.innerHTML = '<article class="text-document">' + sanitizeHtml(await file.text()) + '</article>';
      else if (/\.(txt|md|markdown|csv)$/i.test(file.name)) renderPlainDocument(doc.surface, await file.text());
      else if (/\.doc$/i.test(file.name)) throw new Error('旧版 DOC 请先另存为 DOCX');
      else throw new Error('支持 DOCX、PDF、TXT、MD 和 HTML');
      doc.card.classList.add('doc-loaded');
      doc.card.classList.remove('compared', 'dirty');
      doc.name.textContent = file.name;
      doc.state.textContent = '可编辑';
      syncDocument(side, false);
      saveLocal();
      toast(file.name + ' 已打开，可直接修改');
    } catch (error) {
      toast(error.message || '文件打开失败');
    } finally {
      label.classList.remove('loading');
      doc.file.value = '';
    }
  }

  function bindDropZone(side) {
    const doc = docs[side];
    ['dragenter','dragover'].forEach(eventName => doc.card.addEventListener(eventName, event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      doc.card.classList.add('dragging');
    }));
    doc.card.addEventListener('dragleave', event => {
      if (!doc.card.contains(event.relatedTarget)) doc.card.classList.remove('dragging');
    });
    doc.card.addEventListener('drop', event => {
      event.preventDefault();
      doc.card.classList.remove('dragging');
      loadFile(event.dataTransfer.files?.[0], side);
    });
    doc.surface.addEventListener('input', () => { syncDocument(side, true); saveLocal(); });
    doc.surface.addEventListener('paste', () => setTimeout(() => { syncDocument(side, true); saveLocal(); }, 0));
    doc.file.addEventListener('change', event => loadFile(event.target.files?.[0], side));
  }

  function bindToolbar(side) {
    document.querySelectorAll('.format-toolbar[data-side="' + side + '"] button').forEach(button => {
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        docs[side].surface.focus();
        document.execCommand(button.dataset.command, false, null);
        syncDocument(side, true);
        saveLocal();
      });
    });
  }

  function plainText() {
    return (editor.innerText || editor.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function updateFinalCount() { $('#finalCount').textContent = plainText().length + ' 字'; }

  function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const htmlA = docs.a.surface.innerHTML;
      const htmlB = docs.b.surface.innerHTML;
      const data = { a: docs.a.text.value, b: docs.b.text.value, final: plainText(), nameA: docs.a.name.textContent, nameB: docs.b.name.textContent };
      if (htmlA.length + htmlB.length < 650000) { data.htmlA = htmlA; data.htmlB = htmlB; }
      try { localStorage.setItem('zijian-workspace-v2', JSON.stringify(data)); }
      catch (_) {
        delete data.htmlA; delete data.htmlB;
        try { localStorage.setItem('zijian-workspace-v2', JSON.stringify(data)); } catch (__) {}
      }
      $('#saveState').innerHTML = '<i></i> 已自动保存';
    }, 350);
  }

  function restoreLocal() {
    try {
      const data = JSON.parse(localStorage.getItem('zijian-workspace-v2'));
      if (!data) return;
      ['a','b'].forEach(side => {
        const upper = side.toUpperCase();
        const html = data['html' + upper], text = data[side];
        if (html) docs[side].surface.innerHTML = html;
        else if (text) renderPlainDocument(docs[side].surface, text);
        if (html || text) docs[side].card.classList.add('doc-loaded');
        if (data['name' + upper]) docs[side].name.textContent = data['name' + upper];
        syncDocument(side, false);
      });
    } catch (_) {}
  }

  function exportText() {
    const content = plainText();
    if (!content) return toast('满意稿还是空的');
    const blob = new Blob(['\ufeff' + content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '字鉴-合并稿-' + new Date().toISOString().slice(0,10) + '.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast('合并稿已导出');
  }

  async function copyText() {
    try { await navigator.clipboard.writeText(plainText()); toast('已复制满意稿'); }
    catch (_) { toast('复制失败，请手动选择文字'); }
  }

  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2500);
  }

  ['a','b'].forEach(side => { bindDropZone(side); bindToolbar(side); });
  restoreLocal();
  updateCounts();
  editor.addEventListener('input', () => { updateFinalCount(); saveLocal(); });
  $('#compareBtn').addEventListener('click', renderComparison);
  $('#recompareBtn').addEventListener('click', renderComparison);
  $('#exportBtn').addEventListener('click', exportText);
  $('#sideExportBtn').addEventListener('click', exportText);
  $('#copyBtn').addEventListener('click', copyText);
  $('#clearFormatBtn').addEventListener('click', () => { editor.textContent = plainText(); updateFinalCount(); saveLocal(); toast('已转换为纯文本'); });
  $('#newProjectBtn').addEventListener('click', () => {
    if (!confirm('开始新对比将清空当前内容，确定继续吗？')) return;
    ['a','b'].forEach(side => {
      docs[side].surface.innerHTML = '';
      docs[side].text.value = '';
      docs[side].card.classList.remove('doc-loaded','compared','dirty');
      docs[side].name.textContent = side === 'a' ? '拖入原始稿' : '拖入修订稿';
      docs[side].state.textContent = '可编辑';
    });
    editor.innerHTML = '';
    reviewStage.hidden = true;
    localStorage.removeItem('zijian-workspace-v2');
    updateCounts();
    toast('已新建空白对比');
  });
})();
