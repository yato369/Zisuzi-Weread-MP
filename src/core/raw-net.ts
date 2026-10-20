/**
 * Node 原生 https 请求 —— 插件里唯一能看到 Set-Cookie 的通道。
 *
 * 背景：wr_skey 过期后，微信读书前端靠 POST /web/login/renewal 拿 Set-Cookie 换新 skey，
 * 整个过程不需要用户重新扫码。但 Obsidian 的 requestUrl 会把 set-cookie 从响应头里
 * 剥掉（forbidden header，实测只回 6 个头），Electron 会话容器在渲染进程里也拿不到。
 * Node 的 https 模块不做任何剥离：res.headers['set-cookie'] 原样可见。
 *
 * 只用于续期这类低频请求（每 80 分钟一次），列表/正文仍走 requestUrl（保持既有风控节奏）。
 */
import { nodeRequire } from './typed';

export interface RawResp {
  status: number;
  headers: Record<string, string | string[]>;
  text: string;
  /** status = 0 时的失败原因 */
  error?: string;
}

interface NodeRequester {
  (opts: Record<string, unknown>, cb?: (res: NodeIncoming) => void): NodeRawRequest;
}

interface NodeRawRequest {
  on: (ev: string, cb: (e?: unknown) => void) => void;
  end: (body?: string) => void;
  destroy?: () => void;
}

interface NodeIncoming {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on: (ev: string, cb: (c?: unknown) => void) => void;
}

interface NodeHttpsModule {
  request: NodeRequester;
}

/** GET/POST 一个 URL，跟随 GET 重定向（最多 3 跳）；永不 reject，失败用 status=0 表达 */
export function nodeRawRequest(
  url: string,
  headers: Record<string, string>,
  method: 'GET' | 'POST' = 'GET',
  timeoutMs = 15000,
  redirects = 3,
): Promise<RawResp> {
  return new Promise((resolve) => {
    const req = nodeRequire();
    const httpsMod = req?.<NodeHttpsModule>('https');
    if (!httpsMod?.request) {
      resolve({ status: 0, headers: {}, text: '', error: 'NO_NODE_HTTPS' });
      return;
    }
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve({ status: 0, headers: {}, text: '', error: 'BAD_URL' });
      return;
    }
    try {
      const r = httpsMod.request(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method,
          headers: { ...headers, Host: u.hostname },
          timeout: timeoutMs,
        },
        (res: NodeIncoming) => {
          const msg = res as NodeIncoming;
          const chunks: Buffer[] = [];
          msg.on('data', (c) => chunks.push(c as Buffer));
          msg.on('end', () => {
            const status = msg.statusCode || 0;
            const loc = msg.headers['location'];
            // GET 重定向跟一跟；续期接口基本不重定向，这是给首页探测用的
            if (status >= 300 && status < 400 && loc && redirects > 0 && method === 'GET') {
              try {
                const next = new URL(String(loc), url).toString();
                resolve(nodeRawRequest(next, headers, method, timeoutMs, redirects - 1));
              } catch {
                resolve({ status: 0, headers: {}, text: '', error: 'BAD_REDIRECT' });
              }
              return;
            }
            const hs: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(msg.headers)) {
              if (v !== undefined) hs[k] = v as string | string[];
            }
            resolve({ status, headers: hs, text: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      r.on('timeout', () => {
        try {
          r.destroy?.();
        } catch {
          /* noop */
        }
        resolve({ status: 0, headers: {}, text: '', error: 'TIMEOUT' });
      });
      r.on('error', (e?: unknown) => {
        resolve({ status: 0, headers: {}, text: '', error: e instanceof Error ? e.message : String(e) });
      });
      r.end();
    } catch (e) {
      resolve({ status: 0, headers: {}, text: '', error: e instanceof Error ? e.message : String(e) });
    }
  });
}
