import { eq } from 'drizzle-orm';
import BizError from '../error/biz-error';
import { huaweiAccount } from '../entity/huawei-account';
import orm from '../entity/orm';
import userService from './user-service';
import loginService from './login-service';
import cryptoUtils from '../utils/crypto-utils';
import JwtUtils from '../utils/jwt-utils';
import huaweiAccountInitService from './huawei-account-init-service';

const HUAWEI_TOKEN_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const HUAWEI_TOKEN_INFO_URL =
	'https://oauth-api.cloud.huawei.com/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo';
const HUAWEI_PROFILE_URL =
	'https://account.cloud.huawei.com/rest.php?nsp_svc=GOpen.User.getInfo';
const BIND_TOKEN_EXPIRE_SECONDS = 10 * 60;
const BIND_TOKEN_PURPOSE = 'huawei_mail_binding';

const huaweiAccountService = {
	async login(c, params) {
		const authorizationCode = String(params.authorizationCode || '').trim();
		if (!authorizationCode) {
			throw new BizError('未获取到华为账号授权码', 400);
		}

		await huaweiAccountInitService.ensure(c);
		const identity = await this.exchangeIdentity(c, authorizationCode);
		const binding = await this.selectByHuaweiUserId(c, identity.huaweiUserId);

		if (!binding) {
			const bindToken = await JwtUtils.generateToken(c, {
				purpose: BIND_TOKEN_PURPOSE,
				huaweiUserId: identity.huaweiUserId,
				unionId: identity.unionId,
				openId: identity.openId,
				nickName: identity.nickName,
				avatarUrl: identity.avatarUrl
			}, BIND_TOKEN_EXPIRE_SECONDS);
			return { status: 'UNBOUND', bindToken };
		}

		await this.updateProfile(c, identity);
		const userRow = await userService.selectById(c, binding.userId);
		if (!userRow) {
			throw new BizError('绑定的邮箱账号不存在或已停用', 409);
		}

		const token = await loginService.login(c, { email: userRow.email, password: null }, true);
		return { status: 'BOUND', token, email: userRow.email };
	},

	async bindExisting(c, params) {
		const identity = await this.verifyBindToken(c, params.bindToken);
		const email = String(params.email || '').trim();
		const password = String(params.password || '');

		if (!email || !password) {
			throw new BizError('请输入邮箱账号和密码', 400);
		}

		const userRow = await userService.selectByEmail(c, email);
		if (!userRow) {
			throw new BizError('邮箱账号不存在', 404);
		}
		const passwordMatches = await cryptoUtils.verifyPassword(password, userRow.salt, userRow.password);
		if (!passwordMatches) {
			throw new BizError('邮箱账号或密码错误', 401);
		}

		await this.bind(c, identity, userRow.userId);
		const token = await loginService.login(c, { email: userRow.email, password: null }, true);
		return { token, email: userRow.email };
	},

	async register(c, params) {
		const identity = await this.verifyBindToken(c, params.bindToken);
		const email = String(params.email || '').trim();
		const code = String(params.code || '').trim();

		if (!email) {
			throw new BizError('请输入要注册的邮箱账号', 400);
		}

		const password = cryptoUtils.genRandomPwd(24);
		await loginService.register(c, { email, password, code }, true);
		const userRow = await userService.selectByEmail(c, email);
		if (!userRow) {
			throw new BizError('邮箱注册失败', 500);
		}

		await this.bind(c, identity, userRow.userId);
		const token = await loginService.login(c, { email: userRow.email, password: null }, true);
		return { token, email: userRow.email };
	},

	async exchangeIdentity(c, authorizationCode) {
		const clientId = String(c.env.huawei_client_id || '').trim();
		const clientSecret = String(c.env.huawei_client_secret || '').trim();
		if (!clientId || !clientSecret) {
			throw new BizError('服务端尚未配置华为账号登录', 503);
		}

		const tokenParams = new URLSearchParams();
		tokenParams.append('grant_type', 'authorization_code');
		tokenParams.append('client_id', clientId);
		tokenParams.append('client_secret', clientSecret);
		tokenParams.append('code', authorizationCode);
		tokenParams.append('supportAlg', 'PS256');

		const tokenResponse = await fetch(HUAWEI_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: tokenParams.toString()
		});
		const tokenPayload = await tokenResponse.json();
		if (!tokenResponse.ok || !tokenPayload.access_token) {
			console.error('Huawei token exchange failed', tokenResponse.status, tokenPayload.error);
			throw new BizError('华为账号授权已失效，请重新登录', 401);
		}

		const infoParams = new URLSearchParams();
		infoParams.append('access_token', tokenPayload.access_token);
		infoParams.append('open_id', 'OPENID');

		const infoResponse = await fetch(HUAWEI_TOKEN_INFO_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: infoParams.toString()
		});
		const infoPayload = await infoResponse.json();
		const nspStatus = infoResponse.headers.get('NSP_STATUS');
		if (!infoResponse.ok || (nspStatus && nspStatus !== '0')) {
			console.error('Huawei token verification failed', infoResponse.status, nspStatus);
			throw new BizError('华为账号身份校验失败，请重试', 401);
		}

		if (String(infoPayload.client_id || '') !== clientId) {
			throw new BizError('华为账号凭证不属于当前应用', 401);
		}

		const openId = String(infoPayload.open_id || '').trim();
		const unionId = String(infoPayload.union_id || '').trim();
		const huaweiUserId = unionId || openId;
		if (!openId || !huaweiUserId) {
			throw new BizError('华为账号未返回有效身份标识', 401);
		}

		const profile = await this.fetchProfile(tokenPayload.access_token);
		return {
			huaweiUserId,
			unionId: unionId || null,
			openId,
			nickName: profile.nickName,
			avatarUrl: profile.avatarUrl
		};
	},

	async fetchProfile(accessToken) {
		const profileParams = new URLSearchParams();
		profileParams.append('access_token', accessToken);
		profileParams.append('getNickName', '1');
		try {
			const response = await fetch(HUAWEI_PROFILE_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: profileParams.toString()
			});
			const nspStatus = response.headers.get('NSP_STATUS');
			if (!response.ok || (nspStatus && nspStatus !== '0')) {
				return { nickName: null, avatarUrl: null };
			}
			const payload = await response.json();
			return {
				nickName: String(payload.displayName || '').trim() || null,
				avatarUrl: String(payload.headPictureURL || '').trim() || null
			};
		} catch (error) {
			console.warn('Huawei profile request failed', error instanceof Error ? error.message : 'unknown');
			return { nickName: null, avatarUrl: null };
		}
	},

	async verifyBindToken(c, bindToken) {
		const token = String(bindToken || '').trim();
		const payload = await JwtUtils.verifyToken(c, token);
		if (!payload || payload.purpose !== BIND_TOKEN_PURPOSE || !payload.huaweiUserId || !payload.openId) {
			throw new BizError('绑定凭证已失效，请重新使用华为账号登录', 401);
		}
		return {
			huaweiUserId: String(payload.huaweiUserId),
			unionId: payload.unionId ? String(payload.unionId) : null,
			openId: String(payload.openId),
			nickName: payload.nickName ? String(payload.nickName) : null,
			avatarUrl: payload.avatarUrl ? String(payload.avatarUrl) : null
		};
	},

	async bind(c, identity, userId) {
		const existingHuawei = await this.selectByHuaweiUserId(c, identity.huaweiUserId);
		if (existingHuawei) {
			throw new BizError('该华为账号已绑定其他主邮箱', 409);
		}

		const existingUser = await this.selectByUserId(c, userId);
		if (existingUser) {
			throw new BizError('该主邮箱已绑定其他华为账号', 409);
		}

		try {
			await orm(c).insert(huaweiAccount).values({
				huaweiUserId: identity.huaweiUserId,
				unionId: identity.unionId,
				openId: identity.openId,
				userId,
				nickName: identity.nickName,
				avatarUrl: identity.avatarUrl,
				profileUpdateTime: identity.nickName || identity.avatarUrl ? new Date().toISOString() : null
			}).run();
		} catch (error) {
			if (String(error.message || '').includes('UNIQUE constraint failed')) {
				throw new BizError('华为账号或主邮箱已被绑定', 409);
			}
			throw error;
		}
	},

	async updateProfile(c, identity) {
		if (!identity.nickName && !identity.avatarUrl) {
			return;
		}
		await c.env.db.prepare(`
			UPDATE huawei_account
			SET nick_name = COALESCE(?1, nick_name),
				avatar_url = COALESCE(?2, avatar_url),
				profile_update_time = CURRENT_TIMESTAMP
			WHERE huawei_user_id = ?3
		`).bind(identity.nickName, identity.avatarUrl, identity.huaweiUserId).run();
	},

	selectByHuaweiUserId(c, huaweiUserId) {
		return orm(c).select().from(huaweiAccount)
			.where(eq(huaweiAccount.huaweiUserId, huaweiUserId)).get();
	},

	selectByUserId(c, userId) {
		return orm(c).select().from(huaweiAccount)
			.where(eq(huaweiAccount.userId, userId)).get();
	}
};

export default huaweiAccountService;
