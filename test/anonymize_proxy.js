import _ from 'underscore';
import { expect, assert } from 'chai';
import proxy from 'proxy';
import http from 'http';
import basicAuthParser from 'basic-auth-parser';
import request from 'request';
import express from 'express';

import { anonymizeProxy, closeAnonymizedProxy } from '../build/anonymize_proxy';
import { PORT_SELECTION_CONFIG } from '../build/tools';

/* globals process */

const ORIG_PORT_SELECTION_CONFIG = { ...PORT_SELECTION_CONFIG };

let proxyServer;
let proxyPort; // eslint-disable-line no-unused-vars
let testServerPort;
const proxyAuth = { scheme: 'Basic', username: 'username', password: 'password' };
let wasProxyCalled = false; // eslint-disable-line no-unused-vars

// Setup local proxy server and web server for the tests
before(() => {
    // Find free port for the proxy
    let freePorts;
    return Promise.resolve([20201, 20202])
        .then((result) => {
            freePorts = result;
            return new Promise((resolve, reject) => {
                const httpServer = http.createServer();

                // Setup proxy authorization
                httpServer.authenticate = function (req, fn) {
                    // parse the "Proxy-Authorization" header
                    const auth = req.headers['proxy-authorization'];
                    if (!auth) {
                        // optimization: don't invoke the child process if no
                        // "Proxy-Authorization" header was given
                        // console.log('not Proxy-Authorization');
                        return fn(null, false);
                    }
                    const parsed = basicAuthParser(auth);
                    const isEqual = _.isEqual(parsed, proxyAuth);
                    // console.log('Parsed "Proxy-Authorization": parsed: %j expected: %j : %s', parsed, proxyAuth, isEqual);
                    if (isEqual) wasProxyCalled = true;
                    fn(null, isEqual);
                };

                httpServer.on('error', reject);

                proxyServer = proxy(httpServer);
                proxyServer.listen(freePorts[0], () => {
                    proxyPort = proxyServer.address().port;
                    resolve();
                });
            });
        })
        .then(() => {
            const app = express();

            app.get('/', (req, res) => res.send('Hello World!'));

            testServerPort = freePorts[1];
            return new Promise((resolve, reject) => {
                app.listen(testServerPort, (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
        });
});

after(function () {
    this.timeout(5 * 1000);
    if (proxyServer) return new Promise(resolve => {
        proxyServer.close();
        resolve();
    });
});


const requestPromised = (opts) => {
    // console.log('requestPromised');
    // console.dir(opts);
    return new Promise((resolve, reject) => {
        request(opts, (error, response, body) => {
            if (error) return reject(error);
            if (response.statusCode !== 200) {
                return reject(new Error(`Received invalid response code: ${response.statusCode}`));
            }
            if (opts.expectBodyContainsText) expect(body).to.contain(opts.expectBodyContainsText);
            resolve();
        });
    });
};


describe('utils.anonymizeProxy', function () {
    // Need larger timeout for Travis CI
    this.timeout(5 * 1000);
    it('throws for invalid args', () => {
        assert.throws(() => { anonymizeProxy(null); }, Error);
        assert.throws(() => { anonymizeProxy(); }, Error);
        assert.throws(() => { anonymizeProxy({}); }, Error);
    });

    it('throws for unsupported proxy protocols', () => {
        assert.throws(() => { anonymizeProxy('socks://whatever.com'); }, Error);
        assert.throws(() => { anonymizeProxy('https://whatever.com'); }, Error);
        assert.throws(() => { anonymizeProxy('socks5://whatever.com'); }, Error);
    });

    it('throws for invalid URLs', () => {
        assert.throws(() => { anonymizeProxy('://whatever.com'); }, Error);
        assert.throws(() => { anonymizeProxy('https://whatever.com'); }, Error);
        assert.throws(() => { anonymizeProxy('http://no-port-specified'); }, Error);
        assert.throws(() => { anonymizeProxy('socks5://whatever.com'); }, Error);
        assert.throws(() => { anonymizeProxy('http://no-port-provided'); }, Error);
    });

    it('keeps already anonymous proxies (both with callbacks and promises)', () => {
        return Promise.resolve()
            .then(() => {
                return anonymizeProxy('http://whatever:4567', { port: 4567 });
            })
            .then((anonymousProxyUrl) => {
                expect(anonymousProxyUrl).to.eql('http://whatever:4567');
            })
            .then(() => {
                return new Promise((resolve, reject) => {
                    anonymizeProxy('http://whatever:4567', { port: 30335 }, (err, result) => {
                        if (err) return reject(err);
                        resolve(result);
                    });
                });
            })
            .then((anonymousProxyUrl) => {
                expect(anonymousProxyUrl).to.eql('http://whatever:4567');
            });
    });

    it('anonymizes authenticated upstream proxy (both with callbacks and promises)', () => {
        let proxyUrl1;
        let proxyUrl2;
        return Promise.resolve()
            .then(() => {
                return Promise.all([
                    anonymizeProxy(`http://${proxyAuth.username}:${proxyAuth.password}@127.0.0.1:${proxyPort}`, { port: 34136 }),
                    new Promise((resolve, reject) => {
                        anonymizeProxy(`http://${proxyAuth.username}:${proxyAuth.password}@127.0.0.1:${proxyPort}`, { port: 45620 }, (err, result) => {
                            if (err) return reject(err);
                            resolve(result);
                        });
                    })
                ]);
            })
            .then((results) => {
                proxyUrl1 = results[0];
                proxyUrl2 = results[1];
                expect(proxyUrl1).to.not.contain(`${proxyPort}`);
                expect(proxyUrl2).to.not.contain(`${proxyPort}`);
                expect(proxyUrl1).to.not.equal(proxyUrl2);

                // Test call through proxy 1
                wasProxyCalled = false;
                return requestPromised({
                    uri: `http://localhost:${testServerPort}`,
                    proxy: proxyUrl1,
                    expectBodyContainsText: 'Hello World!',
                });
            })
            .then(() => {
                expect(wasProxyCalled).to.equal(true);
            })
            .then(() => {
                // Test call through proxy 2
                wasProxyCalled = false;
                return requestPromised({
                    uri: `http://localhost:${testServerPort}`,
                    proxy: proxyUrl2,
                    expectBodyContainsText: 'Hello World!',
                });
            })
            .then(() => {
                expect(wasProxyCalled).to.equal(true);
            })
            .then(() => {
                // Test again call through proxy 1
                wasProxyCalled = false;
                return requestPromised({
                    uri: `http://localhost:${testServerPort}`,
                    proxy: proxyUrl1,
                    expectBodyContainsText: 'Hello World!',
                });
            })
            .then(() => {
                expect(wasProxyCalled).to.equal(true);
            })
            .then(() => {
                return closeAnonymizedProxy(proxyUrl1, true);
            })
            .then((closed) => {
                expect(closed).to.eql(true);

                // Test proxy is really closed
                return requestPromised({
                    uri: proxyUrl1,
                })
                .then(() => {
                    assert.fail();
                })
                .catch((err) => {
                    expect(err.message).to.contain('ECONNREFUSED');
                });
            })
            .then(() => {
                // Test callback-style
                return new Promise((resolve, reject) => {
                    closeAnonymizedProxy(proxyUrl2, true, (err, closed) => {
                        if (err) return reject(err);
                        resolve(closed);
                    });
                });
            })
            .then((closed) => {
                expect(closed).to.eql(true);

                // Test the second-time call to close
                return closeAnonymizedProxy(proxyUrl1, true);
            })
            .then((closed) => {
                expect(closed).to.eql(false);

                // Test callback-style
                return new Promise((resolve, reject) => {
                    closeAnonymizedProxy(proxyUrl2, false, (err, closed) => {
                        if (err) return reject(err);
                        resolve(closed);
                    });
                });
            })
            .then((closed) => {
                expect(closed).to.eql(false);
            });
    });

    it('handles many concurrent calls without port collision', () => {
        const N = 20;
        let proxyUrls;

        return Promise.resolve()
            .then(() => {
                // This setting should ensure there will be a port collision,
                // but still there will be some free ports to choose on retry
                PORT_SELECTION_CONFIG.FROM = 40000;
                PORT_SELECTION_CONFIG.TO = 40000 + N + N/2;
                PORT_SELECTION_CONFIG.RETRY_COUNT = 100;

                const promises = [];
                for (let i=0; i<N; i++) {
                    promises.push(anonymizeProxy(`http://${proxyAuth.username}:${proxyAuth.password}@127.0.0.1:${proxyPort}`, { port: 27890 + i }));
                }

                return Promise.all(promises);
            })
            .then((results) => {
                const promises = [];
                proxyUrls = results;
                for (let i=0; i<N; i++) {
                    expect(proxyUrls[i]).to.not.contain(`${proxyPort}`);

                    // Test call through proxy
                    promises.push(requestPromised({
                        uri: `http://localhost:${testServerPort}`,
                        proxy: proxyUrls[i],
                        expectBodyContainsText: 'Hello World!',
                    }));
                }

                return Promise.all(promises);
            })
            .then(() => {
                expect(wasProxyCalled).to.equal(true);
                const promises = [];

                for (let i=0; i<N; i++) {
                    promises.push(closeAnonymizedProxy(proxyUrls[i], true));
                }

                return Promise.all(promises);
            })
            .then((results) => {
                for (let i=0; i<N; i++) {
                    expect(results[i]).to.eql(true);
                }
                Object.assign(PORT_SELECTION_CONFIG, ORIG_PORT_SELECTION_CONFIG);
            })
            .catch(err => {
                Object.assign(PORT_SELECTION_CONFIG, ORIG_PORT_SELECTION_CONFIG);
                throw err;
            });
    });

    it('fails with invalid upstream proxy credentials', () => {
        let anonymousProxyUrl;
        return Promise.resolve()
            .then(() => {
                return anonymizeProxy(`http://username:bad-password@127.0.0.1:${proxyPort}`, { port: 23026});
            })
            .then((result) => {
                anonymousProxyUrl = result;
                expect(anonymousProxyUrl).to.not.contain(`${proxyPort}`);
                wasProxyCalled = false;
                return requestPromised({
                    uri: 'http://whatever',
                    proxy: anonymousProxyUrl,
                });
            })
            .then(() => {
                assert.fail();
            })
            .catch((err) => {
                expect(err.message).to.contains('Received invalid response code: 502'); // Gateway error
                expect(wasProxyCalled).to.equal(false);
            })
            .then(() => {
                return closeAnonymizedProxy(anonymousProxyUrl, true);
            })
            .then((closed) => {
                expect(closed).to.eql(true);
            });
    });

    after(() => {
        Object.assign(PORT_SELECTION_CONFIG, PORT_SELECTION_CONFIG);
    });
});
