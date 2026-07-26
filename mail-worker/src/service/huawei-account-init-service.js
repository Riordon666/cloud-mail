const huaweiAccountInitService = {
	async init(c) {
		const secret = c.req.param('secret');
		if (secret !== c.env.jwt_secret) {
			return false;
		}

		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS huawei_account (
				huawei_account_id INTEGER PRIMARY KEY AUTOINCREMENT,
				huawei_user_id TEXT NOT NULL,
				union_id TEXT,
				open_id TEXT NOT NULL,
				user_id INTEGER NOT NULL,
				create_time DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		await c.env.db.batch([
			c.env.db.prepare(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_huawei_account_huawei_user_id
				ON huawei_account(huawei_user_id)
			`),
			c.env.db.prepare(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_huawei_account_user_id
				ON huawei_account(user_id)
			`)
		]);
		return true;
	}
};

export default huaweiAccountInitService;
