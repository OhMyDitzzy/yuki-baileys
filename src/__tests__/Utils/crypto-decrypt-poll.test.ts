import { aesDecryptGCM, aesEncryptGCM, hmacSign } from '../../Utils/crypto'
import { decryptPollVote, decryptEventResponse } from '../../Utils/process-message'
import { proto } from '../../../WAProto/index.js'
import Long from 'long'

describe('Crypto Functions Runtime Compatibility', () => {
	describe('aesEncryptGCM & aesDecryptGCM', () => {
		it('should encrypt and decrypt data correctly', async () => {
			const plaintext = Buffer.from('Hello World')
			const key = Buffer.from('a'.repeat(32))
			const iv = Buffer.from('b'.repeat(12))
			const aad = Buffer.from('additional data')

			const encrypted = await aesEncryptGCM(plaintext, key, iv, aad)
			expect(encrypted).toBeInstanceOf(Buffer)
			expect(encrypted.length).toBeGreaterThan(plaintext.length) // includes auth tag

			const decrypted = await aesDecryptGCM(encrypted, key, iv, aad)
			expect(decrypted).toBeInstanceOf(Buffer)
			expect(decrypted.toString()).toBe('Hello World')
		})

		it('should fail decryption with wrong key', async () => {
			const plaintext = Buffer.from('Secret Message')
			const key = Buffer.from('a'.repeat(32))
			const wrongKey = Buffer.from('b'.repeat(32))
			const iv = Buffer.from('c'.repeat(12))
			const aad = Buffer.from('metadata')

			const encrypted = await aesEncryptGCM(plaintext, key, iv, aad)

			await expect(aesDecryptGCM(encrypted, wrongKey, iv, aad)).rejects.toThrow()
		})

		it('should fail decryption with wrong AAD', async () => {
			const plaintext = Buffer.from('Secret Message')
			const key = Buffer.from('a'.repeat(32))
			const iv = Buffer.from('c'.repeat(12))
			const aad = Buffer.from('metadata')
			const wrongAad = Buffer.from('wrong-metadata')

			const encrypted = await aesEncryptGCM(plaintext, key, iv, aad)

			await expect(aesDecryptGCM(encrypted, key, iv, wrongAad)).rejects.toThrow()
		})

		it('should handle empty plaintext', async () => {
			const plaintext = Buffer.from('')
			const key = Buffer.from('a'.repeat(32))
			const iv = Buffer.from('b'.repeat(12))
			const aad = Buffer.from('additional data')

			const encrypted = await aesEncryptGCM(plaintext, key, iv, aad)
			const decrypted = await aesDecryptGCM(encrypted, key, iv, aad)

			expect(decrypted.length).toBe(0)
		})

		it('should handle large data', async () => {
			const plaintext = Buffer.from('x'.repeat(10000))
			const key = Buffer.from('a'.repeat(32))
			const iv = Buffer.from('b'.repeat(12))
			const aad = Buffer.from('additional data')

			const encrypted = await aesEncryptGCM(plaintext, key, iv, aad)
			const decrypted = await aesDecryptGCM(encrypted, key, iv, aad)

			expect(decrypted.length).toBe(10000)
			expect(decrypted.toString()).toBe(plaintext.toString())
		})
	})

	describe('Runtime Detection', () => {
		it('should work in current runtime', async () => {
			const plaintext = Buffer.from('Runtime Test')
			const key = Buffer.from('a'.repeat(32))
			const iv = Buffer.from('b'.repeat(12))
			const aad = Buffer.from('test')

			// Should not throw regardless of runtime (Node.js or Bun)
			const encrypted = await aesEncryptGCM(plaintext, key, iv, aad)
			const decrypted = await aesDecryptGCM(encrypted, key, iv, aad)

			expect(decrypted.toString()).toBe('Runtime Test')
		})
	})
})

describe('Poll Vote Decryption', () => {
	it('should decrypt poll vote correctly', async () => {
		// Create mock encrypted poll vote
		const pollCreatorJid = '1234567890@s.whatsapp.net'
		const pollMsgId = 'POLL_MSG_123'
		const pollEncKey = Buffer.from('a'.repeat(32))
		const voterJid = '0987654321@s.whatsapp.net'

		// Create a real poll vote message
		const voteMsg = proto.Message.PollVoteMessage.encode({
			selectedOptions: [Buffer.from('option1')]
		}).finish()

		// Encrypt it using the same logic as WhatsApp
		const sign = Buffer.concat([
			Buffer.from(pollMsgId),
			Buffer.from(pollCreatorJid),
			Buffer.from(voterJid),
			Buffer.from('Poll Vote'),
			new Uint8Array([1])
		])

		const key0 = hmacSign(pollEncKey, new Uint8Array(32), 'sha256')
		const decKey = hmacSign(sign, key0, 'sha256')
		const aad = Buffer.from(`${pollMsgId}\u0000${voterJid}`)
		const iv = Buffer.from('c'.repeat(12))

		const encrypted = await aesEncryptGCM(voteMsg, decKey, iv, aad)

		const encPollVote: proto.Message.IPollEncValue = {
			encPayload: encrypted,
			encIv: iv
		}

		const decrypted = await decryptPollVote(encPollVote, {
			pollCreatorJid,
			pollMsgId,
			pollEncKey,
			voterJid
		})

		expect(decrypted).toBeDefined()
		expect(decrypted.selectedOptions).toBeDefined()
		expect(decrypted.selectedOptions?.length).toBe(1)
		expect(decrypted.selectedOptions?.[0]?.toString()).toBe('option1')
	})

	it('should fail with wrong encryption key', async () => {
		const pollCreatorJid = '1234567890@s.whatsapp.net'
		const pollMsgId = 'POLL_MSG_123'
		const pollEncKey = Buffer.from('a'.repeat(32))
		const wrongKey = Buffer.from('b'.repeat(32))
		const voterJid = '0987654321@s.whatsapp.net'

		const voteMsg = proto.Message.PollVoteMessage.encode({
			selectedOptions: [Buffer.from('option1')]
		}).finish()

		const sign = Buffer.concat([
			Buffer.from(pollMsgId),
			Buffer.from(pollCreatorJid),
			Buffer.from(voterJid),
			Buffer.from('Poll Vote'),
			new Uint8Array([1])
		])

		const key0 = hmacSign(pollEncKey, new Uint8Array(32), 'sha256')
		const decKey = hmacSign(sign, key0, 'sha256')
		const aad = Buffer.from(`${pollMsgId}\u0000${voterJid}`)
		const iv = Buffer.from('c'.repeat(12))

		const encrypted = await aesEncryptGCM(voteMsg, decKey, iv, aad)

		const encPollVote: proto.Message.IPollEncValue = {
			encPayload: encrypted,
			encIv: iv
		}

		await expect(
			decryptPollVote(encPollVote, {
				pollCreatorJid,
				pollMsgId,
				pollEncKey: wrongKey,
				voterJid
			})
		).rejects.toThrow()
	})
})

describe('Event Response Decryption', () => {
	it('should decrypt event response correctly', async () => {
		const eventCreatorJid = '1234567890@s.whatsapp.net'
		const eventMsgId = 'EVENT_MSG_123'
		const eventEncKey = Buffer.from('a'.repeat(32))
		const responderJid = '0987654321@s.whatsapp.net'

		// Create a real event response message
		const responseMsg = proto.Message.EventResponseMessage.encode({
			response: proto.Message.EventResponseMessage.EventResponseType.GOING,
			timestampMs: Long.fromString('1234567890000')
		}).finish()

		// Encrypt it using the same logic as WhatsApp
		const sign = Buffer.concat([
			Buffer.from(eventMsgId),
			Buffer.from(eventCreatorJid),
			Buffer.from(responderJid),
			Buffer.from('Event Response'),
			new Uint8Array([1])
		])

		const key0 = hmacSign(eventEncKey, new Uint8Array(32), 'sha256')
		const decKey = hmacSign(sign, key0, 'sha256')
		const aad = Buffer.from(`${eventMsgId}\u0000${responderJid}`)
		const iv = Buffer.from('c'.repeat(12))

		const encrypted = await aesEncryptGCM(responseMsg, decKey, iv, aad)

		const encEventResponse: proto.Message.IPollEncValue = {
			encPayload: encrypted,
			encIv: iv
		}

		const decrypted = await decryptEventResponse(encEventResponse, {
			eventCreatorJid,
			eventMsgId,
			eventEncKey,
			responderJid
		})

		expect(decrypted).toBeDefined()
		expect(decrypted.response).toBe(proto.Message.EventResponseMessage.EventResponseType.GOING)
		expect(decrypted.timestampMs).toBe('1234567890000')
	})
})