import { Server } from './server';
import { parseUrl, PORT_SELECTION_CONFIG } from './tools';

// Dictionary, key is value returned from anonymizeProxy(), value is Server instance.
const anonymizedProxyUrlToServer = {};

/**
 * Parses and validates a HTTP proxy URL. If the proxy requires authentication, then the function
 * starts an open local proxy server that forwards to the upstream proxy.
 * @param proxyUrl
 * @param options Define options.port
 * @param callback Optional callback that receives the anonymous proxy URL
 * @return If no callback was supplied, returns a promise that resolves to a String with
 * anonymous proxy URL or the original URL if it was already anonymous.
 */
export const anonymizeProxy = (proxyUrl, options={}, callback) => {
    const parsedProxyUrl = parseUrl(proxyUrl);
    if (!parsedProxyUrl.host || !parsedProxyUrl.port) {
        throw new Error('Invalid "proxyUrl" option: the URL must contain both hostname and port.');
    }
    if (parsedProxyUrl.scheme !== 'http') {
        throw new Error('Invalid "proxyUrl" option: only HTTP proxies are currently supported.');
    }

    // If upstream proxy requires no password, return it directly
    if (!parsedProxyUrl.username && !parsedProxyUrl.password) {
        if (typeof callback === 'function') {
            callback(null, proxyUrl);
        }
        return proxyUrl;
    }

    let port;
    let server;

    const startServer = (maxRecursion) => {
        return Promise.resolve()
            .then(() => {
                if (!options || !options.port) {
                    throw new Error('options.port is undefined');
                }
                return options.port;
            })
            .then((result) => {
                port = result;
                server = new Server({
                    // verbose: true,
                    port,
                    prepareRequestFunction: () => {
                        return {
                            requestAuthentication: false,
                            upstreamProxyUrl: proxyUrl,
                        };
                    },
                });

                return server.listen();
            });
    };

    return startServer(PORT_SELECTION_CONFIG.RETRY_COUNT)
        .then(() => {
            const url = `http://127.0.0.1:${port}`;
            anonymizedProxyUrlToServer[url] = server;
            if (typeof callback === 'function') {
                callback(null, url);
            }
            return url;
        });
};

/**
 * Closes anonymous proxy previously started by `anonymizeProxy()`.
 * If proxy was not found or was already closed, the function has no effect
 * and its result if `false`. Otherwise the result is `true`.
 * @param anonymizedProxyUrl
 * @param closeConnections If true, pending proxy connections are forcibly closed.
 * @param callback Optional callback
 * @returns Returns a promise if no callback was supplied
 */
export const closeAnonymizedProxy = (anonymizedProxyUrl, closeConnections, callback) => {
    const server = anonymizedProxyUrlToServer[anonymizedProxyUrl];
    if (!server) {
        if (typeof callback === 'function') {
            return callback(null, false);
        }
        return Promise
            .resolve(false);
    }

    delete anonymizedProxyUrlToServer[anonymizedProxyUrl];

    return server.close(closeConnections)
        .then(() => {
            if (typeof callback === 'function') {
                callback(null, true);
            }
            return true;
        });
};
