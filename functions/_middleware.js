// Nonce CSP par requête — gabarit commun (chantier flotte-csp-nonce).
// À copier tel quel dans <site>/functions/_middleware.js (voir sync.sh).
//
// Sur une réponse HTML portant une CSP avec `script-src` (posée par _headers) :
//   - ajoute `'nonce-<n>'` à la directive `script-src` de CHAQUE politique
//     (_headers peut en produire plusieurs, jointes par ", "), autres
//     directives et ordre inchangés octet pour octet ;
//   - pose `nonce="<n>"` sur chaque <script> via HTMLRewriter ;
//   - supprime ETag/Last-Modified et force `Cache-Control: no-store` : une
//     revalidation 304 servirait un corps en cache avec un nonce périmé.
// Toute autre réponse (asset, fonction existante, absence de CSP ou de
// script-src) est renvoyée intacte. Jamais de `new Response(texte)` : les
// en-têtes de _headers seraient perdus (cf. step-1-inventaire.md §1a).

const NONCE_BYTES = 16; // 128 bits

function directiveName(directive) {
  return directive.trimStart().split(/\s/, 1)[0].toLowerCase();
}

// Ne touche que `script-src` ; `script-src-elem` et `script-src-attr`
// restent inchangés. La comparaison est insensible à la casse.
export function addNonceToScriptSrc(csp, nonce) {
  return csp
    .split(",")
    .map((policy) =>
      policy
        .split(";")
        .map((directive) =>
          directiveName(directive) === "script-src"
            ? `${directive} 'nonce-${nonce}'`
            : directive,
        )
        .join(";"),
    )
    .join(",");
}

export function hasScriptSrc(csp) {
  return csp
    .split(",")
    .some((policy) =>
      policy.split(";").some((d) => directiveName(d) === "script-src"),
    );
}

class ScriptNonce {
  constructor(nonce) {
    this.nonce = nonce;
  }
  element(el) {
    el.setAttribute("nonce", this.nonce);
  }
}

export async function onRequest(context) {
  const res = await context.next();

  const contentType = res.headers.get("content-type") ?? "";
  const csp = res.headers.get("content-security-policy");
  if (!contentType.includes("text/html") || !csp || !hasScriptSrc(csp)) {
    return res;
  }

  const nonceBytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const transformed = new HTMLRewriter()
    .on("script", new ScriptNonce(nonce))
    .transform(res);

  // Réponse dérivée de `transformed` (en-têtes _headers conservés) —
  // headers éditables car HTMLRewriter rend la réponse mutable.
  const response = new Response(transformed.body, transformed);
  response.headers.set("content-security-policy", addNonceToScriptSrc(csp, nonce));
  response.headers.delete("etag");
  response.headers.delete("last-modified");
  response.headers.set("cache-control", "no-store");
  return response;
}
