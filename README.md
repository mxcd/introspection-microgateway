# Introspection Microgateway

The aim of this project is to provide a simple microgateway with OAuth 2.0 Token Introspection.

The original use-case was to provide with introspection capabilities an existing HAProxy deployment.

## Usage

Its use is recommended using the Docker image.

You can download it from the official Docker Registry or just build it from the Dockerfile in this repo.

```
docker run \
    -e SSO_INTROSPECTION="YOUR_SSO_INTROSPECTION_URL" \
    -e SSO_CLIENT_ID="YOUR_SSO_INTROSPECTION_CLIENT_ID" \
    -e SSO_CLIENT_SECRET="YOUR_SSO_INTROSPECTION_SECRET" \
    -e SSL_SECURE="BOOLEAN_SSL_SECURE_OR_NOT" \
    dacamposol/introspection-microgateway
```

The service makes use of `dotenv` so integration with **Docker Swarm** configurations and secrets is trivial.

This approach allows protecting the SSO credentials from being visible by container inspection. As counterpart, in that case the container has to run in a Swarm instance.

```
echo -n 'YOUR_SSO_INTROSPECTION_URL' | docker secret create introspection_url -
echo -n 'YOUR_SSO_INTROSPECTION_CLIENT_ID' | docker secret create introspection_client -
echo -n 'YOUR_SSO_INTROSPECTION_SECRET' | docker secret create introspection_secret -
```

### env.template for golang templating
```
SSO_INTROSPECTION={{ secret "introspection_url" }}
SSO_CLIENT_ID={{ secret "introspection_client" }}
SSO_CLIENT_SECRET={{ secret "introspection_secret" }}
```

### All environment varialbes
| variable name             | required | default    | description                                                                                                                                          |
|---------------------------|----------|------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| SSO_INTROSPECTION         | true     | -          | Token introspection endpoint (can be found on the `${SSO}/.well-known/openid-configuration` page                                                     |
| SSO_CLIENT_ID             | true     | -          | Client ID of your OpenID Connect configuration                                                                                                       |
| SSO_CLIENT_SECRET         | true     | -          | Client Secret of your OpenID Connect configuration                                                                                                   |
| PORT                      | false    | `8080`     | Port on which the proxy server shall listen for incoming requests                                                                                    |
| SSL_SECURE                | false    | `true`     | Proxy checks SSL certificates (see [here](https://github.com/http-party/node-http-proxy#using-https))                                                |
| JWT_HEADER_NAME           | false    | -          | If set, the introspection result will be injected as JWT in the given header                                                                         |
| ALLOW_JWT_PASSTHROUGH     | false    | `false`    | If `true`, it is allowed to call the proxy with the JWT_HEADER_NAME already set. This prevents it from being overwritten by the introspection result |
| JWT_SECRET                | false    | `'secret'` | The secret used to sign the JWT                                                                                                                      |
| ALLOW_MISSING_AUTH_HEADER | false    | `false`    | *WARNING*: only set to `true` if you want to allow unauthorized access to your backend! Set to `true` to ignore the abscense of an `Authorization` header and simply forward the request |
| LOG_LEVEL                 | false    | `'info'`   | Available levels are `'debug'`, `'info'`, `'warn'`, `'error'`                                                                                        |

### docker-compose.yml
```
version: "3.8"
services:
  introspection-mgw:
    image: dacamposol/introspection-microgateway
    ports:
      - "3128:8080"
    configs:
      - source: dotenv
        target: "/usr/app/.env"
    secrets:
      - introspection_url
      - introspection_client
      - introspection_secret

configs:
  dotenv:
    file: "./env.template"
    template_driver: golang

secrets:
  introspection_url:
    external: true
  introspection_client:
    external: true
  introspection_secret:
    external: true
```

## Proxying request

For proxying a request there are only two conditions:

- The request contains a valid **Auth Token** as Bearer authentication in the `Authorization` header.
- The request contains a valid URL for the proxy target in the `Destination` header.[^1] 

Example in cURL:
```
curl -v --header "Destination: https://my-target-url.com" \ 
        --header "Authorization: Bearer 0001HjFxeeGd1m8I6fs44LbC98Fz" \
        localhost:3128/example/path
```

Output example:
``` 
Introspection Proxy listening on port 8080
=== Received request with destination to: [https://my-target-url.com] ===
+ Access Token: [0001HjFxeeGd1m8I6fs44LbC98Fz]
+ Introspection Response: [{
  "sub": "dacamposol",
  "active": true
}]
+ Proxying to: [https://my-target-url.com/example/path]
```

[^1]: I'm not totally convinced with this header name, so inputs about possible names are appreciated.
