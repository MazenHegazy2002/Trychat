// Loaded before the app bundle (injected into index.html by main.js). Routes cross-origin http(s)
// fetches (model API, sync, MCP, web tools) through the main process, so servers without CORS
// headers work. Same-origin and non-http requests use the normal fetch.
(() => {
  const net = window.trychatDesktopNet;
  if (!net) return;
  const nativeFetch = window.fetch.bind(window);
  const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
  let n = 0;

  window.fetch = async function (input, init) {
    let req;
    try {
      req = new Request(input, init);
    } catch {
      return nativeFetch(input, init);
    }
    const url = new URL(req.url, location.href);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === location.origin) return nativeFetch(input, init);
    const signal = req.signal;
    if (signal && signal.aborted) throw abortError();
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : new Uint8Array(await req.arrayBuffer());
    const id = `f${++n}-${Date.now()}`;
    let controller;
    let done = false;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
      cancel() {
        done = true;
        net.abort(id);
      },
    });
    const cleanup = () => signal && signal.removeEventListener('abort', onAbort);
    function onAbort() {
      net.abort(id);
      if (!done) {
        done = true;
        try {
          controller.error(abortError());
        } catch {}
      }
    }
    if (signal) signal.addEventListener('abort', onAbort);

    let head;
    try {
      head = await net.request(id, { url: url.href, method: req.method, headers: [...req.headers], body, redirect: req.redirect }, (type, payload) => {
        if (done) return;
        if (type === 'chunk') controller.enqueue(new Uint8Array(payload));
        else if (type === 'end') {
          done = true;
          cleanup();
          controller.close();
        } else if (type === 'error') {
          done = true;
          cleanup();
          controller.error(new TypeError(String(payload)));
        }
      });
    } catch (e) {
      cleanup();
      if (signal && signal.aborted) throw abortError();
      throw new TypeError(`Failed to fetch: ${(e && e.message) || e}`);
    }
    const noBody = [101, 204, 205, 304].includes(head.status) || req.method === 'HEAD';
    if (noBody) net.abort(id);
    const res = new Response(noBody ? null : stream, { status: head.status, statusText: head.statusText, headers: head.headers });
    Object.defineProperty(res, 'url', { value: head.url });
    Object.defineProperty(res, 'redirected', { value: head.redirected });
    return res;
  };
})();
