import http from 'http';
import dotenv from 'dotenv';
import Console from 'node:console';
import fetch from 'node-fetch';
import validUrl from 'valid-url';
import httpProxy from 'http-proxy';

dotenv.config();

const proxy = httpProxy.createProxyServer({});

http
  .createServer(async (req, res) => {
    const authHeader = req.headers.authorization;
    const destinationHeader = req.headers.destination;

    // Validate the Destination Header
    if (destinationHeader && validUrl.isUri(destinationHeader)) {
      Console.log(
        `=== Received request with destination to: [${destinationHeader}] ===`,
      );
    } else {
      Console.error(
        `- Received request with incorrect Destination: [${destinationHeader}]`,
      );
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Destination header should be a valid URL');
      return;
    }

    // Validate the Authorization Header
    let accessToken;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7, authHeader.length);
      Console.log(`+ Access Token: [${accessToken}]`);
    } else {
      Console.error(
        `- Received request with incorrect Authorization: [${authHeader}]`,
      );
      res.writeHead(401, {
        'Content-Type': 'text/plain',
      });
      res.end('Access Token needed for the given URL');
      return;
    }

    // Validate the Access Token
    let responseData;

    if (typeof accessToken !== 'undefined') {
      const introspectionResponse = await fetch(process.env.SSO_INTROSPECTION,
        {
          method: 'POST',
          body: new URLSearchParams(`token=${accessToken}`),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(
              `${process.env.SSO_CLIENT_ID}:${process.env.SSO_CLIENT_SECRET}`,
            ).toString('base64')}`,
          },
        });
      responseData = await introspectionResponse.json();
      Console.log(
        `+ Introspection Response: [${JSON.stringify(
          {
            sub: responseData.active ? responseData.sub : undefined,
            active: responseData.active,
          },
          null,
          '  ',
        )}]`,
      );
    } else {
      Console.error(
        '- The parsed token is undefined, even if the header is correct',
      );
      res.writeHead(500, {
        'Content-Type': 'text/plain',
      });
      res.end('Internal Server Error');
    }

    // Validate the Token Introspection
    if (responseData.active) {
      Console.log(`+ Proxying to: [${destinationHeader + req.url}]`);
      proxy.web(req, res, {
        target: destinationHeader,
        secure: process.env.SSL_SECURE ? process.env.SSL_SECURE : true,
      });
    } else {
      Console.error(`- The access token [${accessToken}] is not valid`);
      res.writeHead(401, {
        'Content-Type': 'text/plain',
      });
      res.end('Access Token is invalid');
    }
  })
  .listen(8080, (err) => {
    if (err) Console.error('Error starting HTTP server', err);
    else Console.log('Introspection Proxy listening on port 8080');
  });

process.on('unhandledRejection', (err) => {
  Console.error('(!) Unhandled Promise rejection:', err);
});

proxy.on('error', (err, req, res) => {
  res.writeHead(500, {
    'Content-Type': 'text/plain',
  });

  Console.error(err);
  res.end(`Something went wrong proxying the request: [${err.code}]`);
});
