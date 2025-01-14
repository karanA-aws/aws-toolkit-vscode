/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import sinon from 'sinon'
import { PrepareCodeGenState, ConversationNotStartedState } from '../../../amazonqFeatureDev/session/sessionState'
import { createMessenger } from '../utils'
import { FeatureDevClient } from '../../../amazonqFeatureDev/client/featureDev'
import { Session } from '../../../amazonqFeatureDev'
import { createSessionConfig } from '../../../amazonq/commons/session/sessionConfigFactory'
import { Uri } from 'vscode'

/**
 * Describes the test suite for the Session State Journey.
 * This suite tests various aspects of session state transitions and error handling.
 */
describe('Session State Flow', () => {
    const conversationId = 'conversation-id'
    const uploadId = 'upload-id'
    const tabId = 'tab-id'
    const scheme = 'testScheme'
    let session: Session
    let featureDevClient: FeatureDevClient

    beforeEach(async () => {
        featureDevClient = sinon.createStubInstance(FeatureDevClient)
        featureDevClient.createConversation = sinon.stub().resolves(conversationId)
        featureDevClient.createUploadUrl = sinon.stub().resolves({
            uploadId: uploadId,
            uploadUrl: 'http://test-upload-url',
            $response: {} as any,
        })

        const messenger = createMessenger()
        const sessionConfig = await createSessionConfig(scheme)

        session = new Session(sessionConfig, messenger, tabId, undefined, featureDevClient)
        sinon.stub(session, 'conversationId').get(() => conversationId)
        sinon.stub(session, 'uploadId').get(() => uploadId)
    })

    afterEach(() => {
        sinon.restore()
    })

    describe('SessionState', () => {
        /**
         * Tests the correct state journey of a session.
         * This test case verifies that the session follows the expected state transitions:
         * 1. Starts in ConversationNotStartedState
         * 2. Transitions to PrepareCodeGenState after preloader
         * 3. Remains in PrepareCodeGenState after sending a message
         */
        it('should follow the correct state flow', async () => {
            assert.ok(session.state instanceof ConversationNotStartedState)

            await session.preloader('Initial message')

            assert.ok(session.state instanceof PrepareCodeGenState)

            const interactStub = sinon.stub(PrepareCodeGenState.prototype, 'interact').resolves({
                interaction: { content: 'Test message' },
                nextState: new PrepareCodeGenState(
                    {
                        conversationId: conversationId,
                        uploadId: uploadId,
                        workspaceRoots: [],
                        workspaceFolders: [
                            {
                                uri: Uri.parse('file:///test/workspace'),
                                name: '',
                                index: 0,
                            },
                        ],
                        proxyClient: featureDevClient,
                    },
                    [],
                    [],
                    [],
                    tabId,
                    0
                ),
            })

            await session.send('Test message')
            const prep = session.state as PrepareCodeGenState

            assert.ok(interactStub.calledOnce)
            assert.ok(prep instanceof PrepareCodeGenState)
            assert.ok((featureDevClient.createConversation as sinon.SinonStub).calledOnce)
        })

        /**
         * Tests the handling of errors during sending a message in the session.
         * This test case simulates an error during the interaction process and verifies that the session
         * correctly handles the error by rejecting the promise and keeping the state in PrepareCodeGenState.
         */
        it('should handle errors during send', async () => {
            await session.preloader('Initial message')
            assert.ok(session.state instanceof PrepareCodeGenState)

            const interactStub = sinon
                .stub(PrepareCodeGenState.prototype, 'interact')
                .rejects(new Error('Interaction failed'))

            await assert.rejects(session.send('Test message'), {
                message: 'Interaction failed',
            })

            assert.ok(interactStub.calledOnce)
            assert.ok(session.state instanceof PrepareCodeGenState)
        })

        /**
         * Handles timeout during state transition in a session.
         * This test case simulates a scenario where a state transition takes longer than expected,
         * and ensures that the system handles the timeout appropriately.
         */
        it('should handle timeout during state transition', async () => {
            await session.preloader('Initial message')
            assert.ok(session.state instanceof PrepareCodeGenState)

            const interactStub = sinon.stub(PrepareCodeGenState.prototype, 'interact').callsFake(() => {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve({
                            interaction: { content: 'Test message' },
                            nextState: new PrepareCodeGenState(
                                {
                                    conversationId: conversationId,
                                    uploadId: uploadId,
                                    workspaceRoots: [],
                                    workspaceFolders: [
                                        {
                                            uri: Uri.parse('file:///test/workspace'),
                                            name: '',
                                            index: 0,
                                        },
                                    ],
                                    proxyClient: featureDevClient,
                                },
                                [],
                                [],
                                [],
                                tabId,
                                0
                            ),
                        })
                    }, 5000) // 5 second delay
                })
            })

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout')), 1000) // 1 second timeout
            })

            await assert.rejects(Promise.race([session.send('Test message'), timeoutPromise]), {
                message: 'Timeout',
            })

            assert.ok(interactStub.calledOnce)
            assert.ok(session.state instanceof PrepareCodeGenState)
        })
    })
})
