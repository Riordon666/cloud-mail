import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import huaweiAccountAdminService from '../service/huawei-account-admin-service';

app.get('/huawei/me', async (c) => {
	const binding = await huaweiAccountAdminService.current(c, userContext.getUserId(c));
	return c.json(result.ok(binding));
});

app.get('/huawei/admin/list', async (c) => {
	const data = await huaweiAccountAdminService.list(c, c.req.query());
	return c.json(result.ok(data));
});
