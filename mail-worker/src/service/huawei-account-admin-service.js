import BizError from '../error/biz-error';
import huaweiAccountInitService from './huawei-account-init-service';

function maskHuaweiUserId(value) {
	const id = String(value || '');
	if (id.length <= 12) {
		return id;
	}
	return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

const huaweiAccountAdminService = {
	async current(c, userId) {
		await huaweiAccountInitService.ensure(c);
		const row = await c.env.db.prepare(`
			SELECT ha.huawei_user_id, ha.nick_name, ha.avatar_url,
				ha.profile_update_time, ha.create_time, u.email
			FROM huawei_account ha
			INNER JOIN user u ON u.user_id = ha.user_id
			WHERE ha.user_id = ?1
			LIMIT 1
		`).bind(userId).first();
		if (!row) {
			return null;
		}
		return this.toPublicBinding(row);
	},

	async list(c, query) {
		const currentUser = c.get('user');
		if (!currentUser || currentUser.email !== c.env.admin) {
			throw new BizError('仅管理员可查看华为账号绑定信息', 403);
		}
		await huaweiAccountInitService.ensure(c);
		const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
		const size = Math.min(100, Math.max(1, Number.parseInt(query.size || '20', 10) || 20));
		const keyword = String(query.keyword || '').trim();
		const search = `%${keyword}%`;
		const offset = (page - 1) * size;
		const statements = await c.env.db.batch([
			c.env.db.prepare(`
				SELECT ha.huawei_account_id, ha.huawei_user_id, ha.nick_name, ha.avatar_url,
					ha.profile_update_time, ha.create_time, u.email
				FROM huawei_account ha
				INNER JOIN user u ON u.user_id = ha.user_id
				WHERE (?1 = ''
					OR u.email LIKE ?2
					OR COALESCE(ha.nick_name, '') LIKE ?2
					OR ha.huawei_user_id LIKE ?2)
				ORDER BY ha.create_time DESC
				LIMIT ?3 OFFSET ?4
			`).bind(keyword, search, size, offset),
			c.env.db.prepare(`
				SELECT COUNT(*) AS total
				FROM huawei_account ha
				INNER JOIN user u ON u.user_id = ha.user_id
				WHERE (?1 = ''
					OR u.email LIKE ?2
					OR COALESCE(ha.nick_name, '') LIKE ?2
					OR ha.huawei_user_id LIKE ?2)
			`).bind(keyword, search)
		]);
		const rows = statements[0].results || [];
		const totalRow = (statements[1].results || [])[0];
		return {
			list: rows.map(row => this.toPublicBinding(row)),
			total: Number(totalRow?.total || 0),
			page,
			size
		};
	},

	toPublicBinding(row) {
		return {
			huaweiAccountId: Number(row.huawei_account_id || 0),
			huaweiUserId: maskHuaweiUserId(row.huawei_user_id),
			nickName: String(row.nick_name || ''),
			avatarUrl: String(row.avatar_url || ''),
			primaryEmail: String(row.email || ''),
			profileUpdateTime: String(row.profile_update_time || ''),
			createTime: String(row.create_time || '')
		};
	}
};

export default huaweiAccountAdminService;
