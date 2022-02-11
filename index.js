import http from 'http';
import dotenv from 'dotenv';
import Console from 'node:console';
import fetch from 'node-fetch';
import validUrl from 'valid-url';
import httpProxy from 'http-proxy';
import pkg from 'jsonwebtoken';
import winston from 'winston';
import { format } from 'logform';
const {sign} = pkg;
dotenv.config();

const AVAILABLE_LOG_LEVELS = ['error','warn','info','debug'];
const DEFAULT_LOG_LEVEL = 'info';
const LOG_LEVEL = parseLogLevel(process.env['LOG_LEVEL']);

const LOG_FORMAT = format.combine(
  format.colorize(),
  format.timestamp(),
  // format.align(),
  format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
);

export const log = winston.createLogger({
  level: LOG_LEVEL,
  format: LOG_FORMAT,
  transports: [new winston.transports.Console()]
});

log.info(`Attached logger with log level '${LOG_LEVEL}'`);

function parseLogLevel(level) {
  if(level) {
    if(AVAILABLE_LOG_LEVELS.includes(level)) {
      return level;
    } else {
      console.warn(`Unknown log level '${level}'`);
      failStartup();
      throw new Error('Unknown log level');
    }
  }
  else {
    return DEFAULT_LOG_LEVEL;
  }
}


const proxy = httpProxy.createProxyServer({});

const JWT_HEADER_NAME = process.env.JWT_HEADER_NAME;
const ALLOW_JWT_PASSTHROUGH = process.env.ALLOW_JWT_PASSTHROUGH === 'true';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const SSL_SECURE = process.env.SSL_SECURE === 'true';
const PORT = process.env.PORT || 8080;
const ALLOW_MISSING_AUTH_HEADER = process.env.ALLOW_MISSING_AUTH_HEADER === 'true';

log.info(`Using JWT header name: ${JWT_HEADER_NAME}`);
log.info(ALLOW_JWT_PASSTHROUGH ? 'JWT passthrough enabled' : 'JWT passthrough disabled');
if(ALLOW_MISSING_AUTH_HEADER) {
  log.warn(' ')
  log.warn('############################## WARNING ####################################')
  log.warn('#  Allowing missing auth header => Unauthorized requests will be allowed  #');
  log.warn('###########################################################################')
  log.warn(' ')
}

async function introspectAccessToken(accessToken) {
  try {
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
      }
    );
    const responseData = await introspectionResponse.json();
    log.debug(`\n${JSON.stringify(responseData, null, 2)}`);
    return responseData;
  } catch(e) {
    log.error(`Error introspecting access token: ${e} @ SSO '${process.env.SSO_INTROSPECTION}'`);
    return null;
  }
}

function extractAccessToken(req) {
  const authHeader = req.headers.authorization;
  if(!authHeader) {
    log.debug('No auth header present');
    return null;
  }
  if (!authHeader.startsWith('Bearer ')) {
    log.warn("Invalid auth header. 'Authorization' header is expected to start with 'Bearer '");
    return null;
  }
  const accessToken = authHeader.substring(7, authHeader.length);
  log.debug(`Access Token: [${accessToken}]`);
  return accessToken;
}

http
  .createServer(async (req, res) => {
    const destinationHeader = req.headers.destination;

    const forwardRequest = () => {
      log.info(`Proxying to [${destinationHeader + req.url}]`);
      proxy.web(req, res, {
        target: destinationHeader,
        secure: SSL_SECURE,
      });
    }

    // Validate the Destination Header
    if (destinationHeader && validUrl.isUri(destinationHeader)) {
      log.debug(`Received request with destination to: [${destinationHeader}]`);
    } else {
      log.warn(`Received request with invalid Destination: [${destinationHeader}]`);
      res.writeHead(400, {
        'Content-Type': 'text/plain',
      });
      res.end('Destination header should be a valid URL');
      return;
    }

    // Validate the Authorization Header
    let accessToken = extractAccessToken(req);

    // Block requests that due to unauthenticated requests
    if(!accessToken) {
      if(ALLOW_MISSING_AUTH_HEADER) {
        // Override JWT header if request passthrough is not allowed
        if(!ALLOW_JWT_PASSTHROUGH && req.headers[JWT_HEADER_NAME]) {
          log.debug(`JWT passthrough is not allowed. Removing JWT header '${JWT_HEADER_NAME}'`);
          delete req.headers[JWT_HEADER_NAME]
        }
        forwardRequest();
      }
      else {
        Console.error(`- Received request with incorrect Authorization: [${authHeader}]`);
        res.writeHead(401, {
          'Content-Type': 'text/plain',
        });
        res.end('Access Token needed for the given URL');
      }
      return;
    }

    // all cases below assume the existance of an access token

    // Validate the Access Token
    const responseData = await introspectAccessToken(accessToken);
    if (!responseData) {
      log.error('The parsed token is undefined, even if the header is correct');
      res.writeHead(500, {'Content-Type': 'text/plain'});
      res.end('Internal Server Error');
      return;
    }

    // Validate the Token Introspection
    if (responseData.active) {
      if(JWT_HEADER_NAME) {
        const setHeader = () => {
          log.debug(`Setting JWT header '${JWT_HEADER_NAME}'`);
          req.headers[JWT_HEADER_NAME] = sign({
            data: responseData
          }, JWT_SECRET, { expiresIn: '1h' });
        };

        if(typeof(req.headers[JWT_HEADER_NAME]) === 'undefined') {
          setHeader();
        } else if(!ALLOW_JWT_PASSTHROUGH) {
          setHeader();
        } else {
          log.debug(`JWT passthrough is allowed. JWT header '${JWT_HEADER_NAME}' is already set`);
        }
      }
      forwardRequest();
      return;
    } else {
      log.warn(`The access token [${accessToken}] is not valid`);
      res.writeHead(401, {'Content-Type': 'text/plain'});
      res.end('Access Token is invalid');
      return;
    }
  })
  .listen(PORT, (err) => {
    if (err) log.error('Error starting HTTP server', err);
    else log.info(`Introspection Proxy listening on port ${PORT}`);
  });

process.on('unhandledRejection', (err) => {
  log.error('(!) Unhandled Promise rejection:', err);
  log.debug(err.stack);
});

proxy.on('error', (err, req, res) => {
  res.writeHead(500, {'Content-Type': 'text/plain'});
  log.error(err);
  res.end(`Something went wrong proxying the request: [${err.code}]`);
});