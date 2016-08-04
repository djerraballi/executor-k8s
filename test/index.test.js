'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

const TEST_TIM_YAML = `
metadata:
  name: {{build_id}}
  job: {{job_id}}
  pipeline: {{pipeline_id}}
command:
- "/opt/screwdriver/launch {{git_org}} {{git_repo}} {{git_branch}} {{job_name}}"
`;

/**
 * Stub for Readable wrapper
 * @method ReadableMock
 */
function ReadableMock() {}
/**
 * Stub for circuit-fuses wrapper
 * @method BreakerMock
 */
function BreakerMock() {}

describe('index', () => {
    let Executor;
    let requestMock;
    let fsMock;
    let executor;
    let readableMock;
    let breakRunMock;
    const testScmUrl = 'git@github.com:screwdriver-cd/hashr.git';
    const testBuildId = '80754af91bfb6d1073585b046fe0a474ce868509';
    const testJobId = '2eda8ad1632af052b0c74d6fcab6058b3a79cf25';
    const testPipelineId = 'aaa83eac6890a9a6e2273ea51d6f2f2915b1a019';
    const testJobName = 'main';
    const jobsUrl = 'https://kubernetes/apis/batch/v1/namespaces/default/jobs';
    const podsUrl = 'https://kubernetes/api/v1/namespaces/default/pods';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        requestMock = {
            post: sinon.stub(),
            get: sinon.stub()
        };

        fsMock = {
            readFileSync: sinon.stub()
        };

        readableMock = {
            wrap: sinon.stub()
        };

        breakRunMock = sinon.stub();

        BreakerMock.prototype.runCommand = breakRunMock;
        ReadableMock.prototype.wrap = readableMock.wrap;

        fsMock.readFileSync.withArgs('/etc/kubernetes/apikey/token').returns('api_key');
        fsMock.readFileSync.withArgs(sinon.match(/config\/job.yaml.tim/))
        .returns(TEST_TIM_YAML);

        mockery.registerMock('stream', {
            Readable: ReadableMock
        });
        mockery.registerMock('fs', fsMock);
        mockery.registerMock('request', requestMock);
        mockery.registerMock('circuit-fuses', BreakerMock);

        /* eslint-disable global-require */
        Executor = require('../index');
        /* eslint-enable global-require */

        executor = new Executor({
            token: 'api_key',
            host: 'kubernetes'
        });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('extends base class', () => {
        assert.isFunction(executor.stop);
        assert.isFunction(executor.start);
    });

    describe('stop', () => {
        const fakeStopResponse = {
            statusCode: 200,
            body: {
                success: 'true'
            }
        };
        const deleteConfig = {
            uri: jobsUrl,
            method: 'DELETE',
            qs: {
                labelSelector: `sdbuild=${testBuildId}`
            },
            headers: {
                Authorization: 'Bearer api_key'
            },
            strictSSL: false
        };

        beforeEach(() => {
            breakRunMock.yieldsAsync(null, fakeStopResponse, fakeStopResponse.body);
        });

        it('calls breaker with correct config', (done) => {
            executor.stop({
                buildId: testBuildId
            }, (err) => {
                assert.isNull(err);
                assert.calledOnce(breakRunMock);
                assert.calledWith(breakRunMock, deleteConfig);
                done();
            });
        });

        it('returns error when breaker does', (done) => {
            const error = new Error('error');

            breakRunMock.yieldsAsync(error);
            executor.stop({
                buildId: testBuildId
            }, (err) => {
                assert.deepEqual(err, error);
                assert.calledOnce(breakRunMock);
                done();
            });
        });

        it('returns error when response is non 200', (done) => {
            const fakeStopErrorResponse = {
                statusCode: 500,
                body: {
                    error: 'foo'
                }
            };

            const returnMessage = 'Failed to delete job: '
                  + `${JSON.stringify(fakeStopErrorResponse.body)}`;

            breakRunMock.yieldsAsync(null, fakeStopErrorResponse);

            executor.stop({
                buildId: testBuildId
            }, (err) => {
                assert.equal(err.message, returnMessage);
                done();
            });
        });
    });

    describe('start', () => {
        const fakeStartResponse = {
            statusCode: 201,
            body: {
                success: true
            }
        };

        beforeEach(() => {
            breakRunMock.yieldsAsync(null, fakeStartResponse, fakeStartResponse.body);
        });

        describe('successful requests', () => {
            it('with scmUrl containing branch', (done) => {
                const postConfig = {
                    uri: jobsUrl,
                    method: 'POST',
                    json: {
                        metadata: {
                            name: testBuildId,
                            job: testJobId,
                            pipeline: testPipelineId
                        },
                        command: ['/opt/screwdriver/launch screwdriver-cd hashr addSD main']
                    },
                    headers: {
                        Authorization: 'Bearer api_key'
                    },
                    strictSSL: false
                };

                executor.start({
                    scmUrl: 'git@github.com:screwdriver-cd/hashr.git#addSD',
                    buildId: testBuildId,
                    jobId: testJobId,
                    jobName: testJobName,
                    pipelineId: testPipelineId,
                    container: 'container'
                }, (err) => {
                    assert.isNull(err);
                    assert.calledOnce(breakRunMock);
                    assert.calledWith(breakRunMock, postConfig);
                    done();
                });
            });

            it('with scmUrl without branch', (done) => {
                const postConfig = {
                    uri: jobsUrl,
                    method: 'POST',
                    json: {
                        metadata: {
                            name: testBuildId,
                            job: testJobId,
                            pipeline: testPipelineId
                        },
                        command: ['/opt/screwdriver/launch screwdriver-cd hashr master main']
                    },
                    headers: {
                        Authorization: 'Bearer api_key'
                    },
                    strictSSL: false
                };

                executor.start({
                    scmUrl: testScmUrl,
                    buildId: testBuildId,
                    jobId: testJobId,
                    jobName: testJobName,
                    pipelineId: testPipelineId,
                    container: 'container'
                }, (err) => {
                    assert.isNull(err);
                    assert.calledOnce(breakRunMock);
                    assert.calledWith(breakRunMock, postConfig);
                    done();
                });
            });
        });

        it('returns error when request responds with error', (done) => {
            const error = new Error('lol');

            breakRunMock.yieldsAsync(error);

            executor.start({
                scmUrl: testScmUrl,
                buildId: testBuildId,
                jobId: testJobId,
                jobName: testJobName,
                pipelineId: testPipelineId,
                container: 'container'
            }, (err) => {
                assert.deepEqual(err, error);
                done();
            });
        });

        it('returns body when request responds with error in response', (done) => {
            const returnResponse = {
                statusCode: 500,
                body: {
                    statusCode: 500,
                    message: 'lol'
                }
            };
            const returnMessage = `Failed to create job: ${JSON.stringify(returnResponse.body)}`;

            breakRunMock.yieldsAsync(null, returnResponse);

            executor.start({
                scmUrl: testScmUrl,
                buildId: testBuildId,
                jobId: testJobId,
                jobName: testJobName,
                pipelineId: testPipelineId,
                container: 'container'
            }, (err, response) => {
                assert.notOk(response);
                assert.equal(err.message, returnMessage);
                done();
            });
        });
    });

    describe('stream', () => {
        const pod = `${podsUrl}?labelSelector=sdbuild=${testBuildId}`;
        const logUrl = `${podsUrl}/mypod/log?container=build&follow=true&pretty=true`;

        it('reply with error when it fails to get pod', (done) => {
            const error = new Error('lol');

            breakRunMock.yieldsAsync(error);
            executor.stream({
                buildId: testBuildId
            }, (err) => {
                assert.isOk(err);
                done();
            });
        });

        it('reply with error when podname is not found', (done) => {
            const returnResponse = {
                statusCode: 200,
                body: {
                    items: []
                }
            };

            breakRunMock.yieldsAsync(null, returnResponse);
            executor.stream({
                buildId: testBuildId
            }, (err) => {
                assert.isOk(err);
                done();
            });
        });

        it('stream logs when podname is found', (done) => {
            const getConfig = {
                url: pod,
                json: true,
                headers: {
                    Authorization: 'Bearer api_key'
                },
                strictSSL: false
            };
            const logConfig = {
                url: logUrl,
                headers: {
                    Authorization: 'Bearer api_key'
                },
                strictSSL: false
            };
            const returnResponse = {
                statusCode: 200,
                body: {
                    items: [{
                        metadata: {
                            name: 'mypod'
                        }
                    }]
                }
            };
            const logGetMock = {
                mock: 'thing'
            };
            const readWrapMock = {
                mock: 'thing2'
            };

            breakRunMock.withArgs(getConfig)
                .yieldsAsync(null, returnResponse);
            requestMock.get.withArgs(logConfig).returns(logGetMock);
            readableMock.wrap.returns(readWrapMock);

            executor.stream({
                buildId: testBuildId
            }, (err, stream) => {
                assert.isNull(err);
                assert.calledOnce(breakRunMock);
                assert.calledOnce(requestMock.get);
                assert.calledWith(breakRunMock, getConfig);
                assert.calledWith(requestMock.get, logConfig);
                assert.calledWith(readableMock.wrap, logGetMock);
                assert.deepEqual(stream, readWrapMock);
                done();
            });
        });
    });
});
