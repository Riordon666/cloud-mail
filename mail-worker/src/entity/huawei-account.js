import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const huaweiAccount = sqliteTable('huawei_account', {
	huaweiAccountId: integer('huawei_account_id').primaryKey({ autoIncrement: true }),
	huaweiUserId: text('huawei_user_id').notNull(),
	unionId: text('union_id'),
	openId: text('open_id').notNull(),
	userId: integer('user_id').notNull(),
	nickName: text('nick_name'),
	avatarUrl: text('avatar_url'),
	profileUpdateTime: text('profile_update_time'),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});
