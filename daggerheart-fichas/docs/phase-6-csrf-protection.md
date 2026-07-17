# Fase 6 — proteção CSRF

A API usa autenticação por cookie `HttpOnly`. Por isso, toda requisição de navegador que altera
estado passa por duas camadas de proteção:

1. validação estrita de `Origin` ou, como fallback, da origem do `Referer`;
2. token CSRF ligado criptograficamente ao cookie de sessão atual.

## Contrato do token

O token tem formato versionado e contém um nonce aleatório mais uma assinatura HMAC. A assinatura
inclui o token bruto da sessão, com separação de domínio própria para CSRF. Consequentemente:

- um token emitido para outra sessão é inválido;
- renovar a sessão invalida o token anterior;
- o servidor não precisa persistir o token no banco;
- comparação de assinatura e de cookie/header usa operação constante.

O backend envia o token em três lugares:

- cookie `daggerheart_csrf_token`, `HttpOnly`, `SameSite=Lax` e com a mesma expiração da sessão;
- header de resposta `X-CSRF-Token`;
- corpo de `GET /auth/csrf`, no campo `csrfToken`.

O cookie participa da verificação, enquanto o frontend usa o header ou o corpo para manter uma
cópia apenas em memória e enviá-la no header das requisições mutáveis.

## Origem confiável

Com `CSRF_ENABLED=true`, `POST`, `PUT`, `PATCH` e `DELETE` exigem uma origem presente em
`CSRF_TRUSTED_ORIGINS`. Quando essa lista está vazia, são usadas as origens de
`CORS_ALLOWED_ORIGINS`.

`POST /auth/login` e `POST /auth/register` não exigem token porque ainda pode não existir sessão,
mas continuam exigindo origem confiável. Endpoints autenticados sem cookie seguem para a camada de
autorização e retornam `401`; não é possível emitir token ligado a uma sessão ausente.

GET, HEAD, OPTIONS, TRACE e os streams SSE não exigem token CSRF.

## Renovação e retry no frontend

O `ApiClient`:

1. chama `GET /auth/csrf` antes da primeira requisição mutável autenticada;
2. compartilha uma única chamada de bootstrap entre requisições concorrentes;
3. adiciona automaticamente `X-CSRF-Token`;
4. captura tokens novos em login, registro, refresh e `/auth/me`;
5. ao receber `403 CSRF_FAILED`, obtém um token novo e repete a requisição exatamente uma vez;
6. limpa o token em memória após logout ou `SESSION_EXPIRED`.

O retry é seguro para a `syncQueue`: uma falha CSRF ocorre antes de o endpoint executar, e a
mutation mantém o mesmo `mutationId` no reenvio.

## Erros públicos

Falhas usam o contrato estável:

```json
{
  "code": "CSRF_FAILED",
  "message": "The request could not be verified.",
  "detail": {
    "reason": "token_missing"
  }
}
```

Razões possíveis:

- `origin_missing`;
- `origin_forbidden`;
- `token_missing`;
- `token_mismatch`;
- `token_invalid`.

A resposta inclui `X-Request-ID`, `Cache-Control: no-store` e os headers CORS aplicáveis. Nenhum
token, cookie ou valor recebido é incluído no erro.

## Configuração

```env
CSRF_ENABLED=true
CSRF_COOKIE_NAME=daggerheart_csrf_token
CSRF_HEADER_NAME=X-CSRF-Token
CSRF_TOKEN_BYTES=32
CSRF_TRUSTED_ORIGINS=
```

No frontend, `VITE_CSRF_HEADER_NAME` deve acompanhar `CSRF_HEADER_NAME` quando o nome padrão for
alterado.

A configuração de produção falha no startup quando CSRF está desativado ou quando uma origem
confiável não é HTTPS explícita.
