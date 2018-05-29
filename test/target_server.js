import http from 'http';
import https from 'https';
import express from 'express';
import bodyParser from 'body-parser';
import WebSocket from 'ws';
import basicAuth from 'basic-auth';
import _ from 'underscore';


/**
 * A HTTP server used for testing. It supports HTTPS and web sockets.
 */
export class TargetServer {
    constructor({
        port, wsPort, useSsl, sslKey, sslCrt,
    }) {
        this.port = port;
        this.useSsl = useSsl;

        this.app = express();

        // Parse an HTML body into a string
        this.app.use(bodyParser.text({ type: 'text/*', limit: '10MB' }));

        this.app.all('/hello-world', this.allHelloWorld.bind(this));
        this.app.all('/echo-request-info', this.allEchoRequestInfo.bind(this));
        this.app.all('/echo-payload', this.allEchoPayload.bind(this));
        this.app.get('/redirect-to-hello-world', this.getRedirectToHelloWorld.bind(this));
        this.app.get('/get-1m-a-chars-together', this.get1MACharsTogether.bind(this));
        this.app.get('/get-1m-a-chars-streamed', this.get1MACharsStreamed.bind(this));
        this.app.get('/basic-auth', this.getBasicAuth.bind(this));
        this.app.get('/get-non-standard-headers', this.getNonStandardHeaders.bind(this));
        this.app.get('/get-repeating-headers', this.getRepeatingHeaders.bind(this));

        this.app.all('*', this.handleHttpRequest.bind(this));

        if (useSsl) {
            this.httpServer = https.createServer({ key: sslKey, cert: sslCrt }, this.app);
        } else {
            this.httpServer = http.createServer(this.app);
        }

        // Web socket server for upgraded HTTP connections
        this.wsUpgServer = new WebSocket.Server({ server: this.httpServer });
        this.wsUpgServer.on('connection', this.onWsConnection.bind(this));

        // Web socket server directly listening on some port
        this.wsDirectServer = new WebSocket.Server({ port: wsPort });
        this.wsDirectServer.on('connection', this.onWsConnection.bind(this));
    }

    listen() {
        return new Promise(resolve => {
            this.httpServer.listen(this.port, () => {
                resolve(this.port);
            });
        })
    }

    allHelloWorld(request, response) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('Hello world!');
    }

    allEchoRequestInfo(request, response) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        const result = _.pick(request, 'headers', 'method');
        response.end(JSON.stringify(result));
    }

    allEchoPayload(request, response) {
        response.writeHead(200, { 'Content-Type': request.headers['content-type'] || 'dummy' });
        // console.log('allEchoPayload: ' + request.body.length);
        response.end(request.body);
    }

    get1MACharsTogether(request, response) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        let str = '';
        for (let i = 0; i < 10000; i++) {
            str += 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        }
        response.end(str);
    }

    get1MACharsStreamed(request, response) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        for (let i = 0; i < 10000; i++) {
            response.write('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        }
        response.end();
    }

    getRedirectToHelloWorld(request, response) {
        const location = `${this.useSsl ? 'https' : 'http'}://localhost:${this.port}/hello-world`;
        response.writeHead(301, { 'Content-Type': 'text/plain', Location: location });
        response.end();
    }

    getBasicAuth(request, response) {
        const auth = basicAuth(request);
        if (!auth || auth.name !== 'john.doe' || auth.pass !== 'Passwd') {
            response.statusCode = 401;
            response.setHeader('WWW-Authenticate', 'Basic realm="MyRealmName"');
            response.end('Unauthorized');
        } else {
            response.end('OK');
        }
    }

    handleHttpRequest(request, response) {
        console.log('Received request');

        // const message = request.body;
        // const remoteAddr = request.socket.remoteAddress;

        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('It works!');
    }

    getNonStandardHeaders(request, response) {
        const headers = {
            'Invalid Header With Space': 'HeaderValue1',
            'X-Normal-Header': 'HeaderValue2',
            // This is a regression test for "TypeError: The header content contains invalid characters"
            // that occurred in production
            'Invalid-Header-Value': 'some\value',
        };

        let msg = `HTTP/1.1 200 OK\r\n`;
        _.each(headers, (value, key) => {
            msg += `${key}: ${value}\r\n`;
        });
        msg += `\r\nHello sir!`;

        request.socket.write(msg, () => {
            request.socket.end();

            // Unfortunately calling end() will not close the socket
            // if client refuses to close it. Hence calling destroy after a short while.
            setTimeout(() => {
                request.socket.destroy();
            }, 100);
        });
    }

    getRepeatingHeaders(request, response) {
        response.writeHead(200, {
            'Content-Type': 'text/plain',
            'Repeating-Header': ['HeaderValue1', 'HeaderValue2'],
        });
        response.end('Hooray!');
    }

    onWsConnection(ws) {
        ws.on('error', (err) => {
            console.log(`Web socket error: ${err.stack || err}`);
            throw err;
        });

        ws.on('close', () => {
            // console.log(`Web socket closed`);
        });

        // Simply send data back
        ws.on('message', (data) => {
            ws.send(`I received: ${data}`);
        });
    }

    close() {
        return new Promise(resolve => {
            this.httpServer.close(() => {
                resolve();
            });
        });
    }
}
