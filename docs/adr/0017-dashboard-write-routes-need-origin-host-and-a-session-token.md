# Dashboard write routes need Origin, Host and a session token

The Dashboard server on 127.0.0.1 began read-only, then gained `DELETE /api/runs/<id>` and `POST /api/runs/<id>/merge`. [Issue #249](https://github.com/TDSchreur/tds-factory/issues/249) adds three more writes: `POST /api/runs/<id>/sync`, `/clean` and `/accept`. Any page the user has open in the same browser can send requests to a loopback port, so each write route is a way for a web page to change Runs, worktrees and pull requests. Binding to loopback does not close that.

Every route that is not a GET or HEAD passes one guard before it does anything, and a request that fails any rule gets 403 and changes nothing:

1. **Host.** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`. This already applies to every route and stops DNS rebinding.
2. **Origin.** The `Origin` header must equal `http://<Host>`. A request with no `Origin` or another one is refused, so only the Dashboard page served by this server can write.
3. **Session token.** The request must carry the header `X-Factory-Token` with the random token this server process generated at start. The Dashboard page reads it from `/api/info`, which another origin cannot read. The token is compared in constant time, lives only in memory and changes on every start. It is never put in a URL, a cookie or a log.
4. **No CORS.** The server sends no `Access-Control-*` headers and answers no preflight, so a browser never lets another origin read a response or send the custom header.

The routes only run named operations of the Run store (`sync`, `clean`, `accept`, `remove`) or the existing merge checks. They take no body and no paths from the request, apart from the Run id, which the store validates. Starting a Run stays in the agent: the Dashboard has no route that starts or advances a Run, because a Run needs an agent to do its work. `accept` builds its findings text from the Run record itself and refuses a Check that is already clean or Accepted, so the Dashboard cannot record a decision the user was not shown.

We chose a token on top of Origin and Host because the Origin check alone trusts the browser to send the header, and a missing or odd header from another client would otherwise pass for a reason that is easy to get wrong. The cost is one extra header on every write and a token that is lost on restart, so an open page must reload after the Dashboard restarts. We did not add cookies or login, since the Dashboard has one local user and no accounts. See [ADR 0003](0003-preact-htm-dashboard.md) for the page itself and the [Dashboard guide](../dashboard.md#write-routes) for the routes.
