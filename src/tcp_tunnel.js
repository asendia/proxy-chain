import net from 'net';
import HandlerTunnelTcpChain from './handler_tunnel_tcp_chain';
import { parseUrl } from './tools';

const runningServers = {};

export function createTunnel(proxyUrl, target, providedOptions = {}, callback) {
    // TODO: More and better validations
    const [trgHost, trgPort] = target.split(':');
    if (!trgHost || !trgPort) throw new Error('target needs to include both hostname and port.');

    const parsedProxyUrl = parseUrl(proxyUrl);
    if (!parsedProxyUrl.hostname) throw new Error('proxyUrl needs to include atleast hostname');
    if (parsedProxyUrl.scheme !== 'http') throw new Error('Currently only "http" scheme is supported');

    const options = {
        verbose: false,
        hostname: 'localhost',
        port: null,
        ...providedOptions,
    };

    return new Promise((resolve, reject) => {
        return resolve(options.port);
    }).then((port) => {
        const server = net.createServer();

        const log = (...args) => {
            if (options.verbose) console.log(...args);
        };

        server.on('connection', (srcSocket) => {
            runningServers[port].connections = srcSocket;
            const remoteAddress = `${srcSocket.remoteAddress}:${srcSocket.remotePort}`;
            log('new client connection from %s', remoteAddress);

            srcSocket.pause();

            const tunnel = new HandlerTunnelTcpChain({
                srcSocket,
                upstreamProxyUrlParsed: parsedProxyUrl,
                trgParsed: {
                    hostname: trgHost,
                    port: trgPort,
                },
                log,
            });

            tunnel.run();

            srcSocket.on('data', onConnData);
            srcSocket.once('close', onConnClose);
            srcSocket.on('error', onConnError);

            function onConnData(d) {
                log('connection data from %s: %j', remoteAddress, d);
            }

            function onConnClose() {
                log('connection from %s closed', remoteAddress);
            }

            function onConnError(err) {
                log('Connection %s error: %s', remoteAddress, err.message);
            }
        });

        return new Promise((resolve) => {
            server.listen(port, (err) => {
                if (err) return reject(err);
                log('server listening to ', server.address());
                runningServers[port] = { server, connections: [] };
                if (typeof callback === 'function') {
                    callback(null, `${options.hostname}:${port}`);
                }
                resolve(`${options.hostname}:${port}`);
            });
        });
    })
    .catch((err) => { throw err; });
}

export function closeTunnel(serverPath, closeConnections, callback) {
    const [hostname, port] = serverPath.split(':');
    if (!hostname) throw new Error('serverPath must contain hostname');
    if (!port) throw new Error('serverPath must contain port');
    if (!runningServers[port]) resolve(false);
    return new Promise((resolve) => {
        if (!runningServers[port]) return resolve(false);
        if (!closeConnections) return resolve();
        runningServers[port].connections.forEach(connection => connection.destroy());
        resolve();
    })
    .then(serverExists => new Promise((resolve) => {
        if (!serverExists) {
            if (typeof callback === 'function') {
                callback(null, false);
            }
            return resolve(false);
        }
        runningServers[port].close(() => {
            delete runningServers[port];
            if (typeof callback === 'function') {
                callback(null, true);
            }
            resolve(true);
        });
    }));
}
