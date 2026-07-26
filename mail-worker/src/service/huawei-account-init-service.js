const huaweiAccountInitService = {
	async init(c) {
		const secret = c.req.param('secret');
		if (secret !== c.env.jwt_secret) {
			return false;
		}

		await this.ensure(c);
		return true;
	},

	async ensure(c) {
		const table = await c.env.db.prepare(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'table' AND name = 'huawei_account'
			LIMIT 1
		`).first();
		if (!table) {
			await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS huawei_account (
					huawei_account_id INTEGER PRIMARY KEY AUTOINCREMENT,
					huawei_user_id TEXT NOT NULL,
					union_id TEXT,
					open_id TEXT NOT NULL,
					user_id INTEGER NOT NULL,
					nick_name TEXT,
					avatar_url TEXT,
					profile_update_time DATETIME,
					create_time DATETIME DEFAULT CURRENT_TIMESTAMP
				)
			`).run();
		}

		const tableInfo = await c.env.db.prepare('PRAGMA table_info(huawei_account)').all();
		const columnNames = new Set((tableInfo.results || []).map(column => column.name));
		const migrations = [];
		if (!columnNames.has('nick_name')) {
			migrations.push(c.env.db.prepare('ALTER TABLE huawei_account ADD COLUMN nick_name TEXT'));
		}
		if (!columnNames.has('avatar_url')) {
			migrations.push(c.env.db.prepare('ALTER TABLE huawei_account ADD COLUMN avatar_url TEXT'));
		}
		if (!columnNames.has('profile_update_time')) {
			migrations.push(c.env.db.prepare(
				'ALTER TABLE huawei_account ADD COLUMN profile_update_time DATETIME'
			));
		}
		if (migrations.length > 0) {
			await c.env.db.batch(migrations);
		}

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
	}
};

export default huaweiAccountInitService;
