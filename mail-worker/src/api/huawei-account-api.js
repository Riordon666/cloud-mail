import app from '../hono/hono';
import result from '../model/result';
import huaweiAccountService from '../service/huawei-account-service';
import huaweiAccountInitService from '../service/huawei-account-init-service';

app.get('/oauth/huawei/init/:secret', async (c) => {
	const initialized = await huaweiAccountInitService.init(c);
	if (!initialized) {
		return c.text('Huawei account init secret mismatch', 401);
	}
	return c.text('success');
});

app.post('/oauth/huawei/login', async (c) => {
	const loginInfo = await huaweiAccountService.login(c, await c.req.json());
	return c.json(result.ok(loginInfo));
});

app.post('/oauth/huawei/bind-existing', async (c) => {
	const loginInfo = await huaweiAccountService.bindExisting(c, await c.req.json());
	return c.json(result.ok(loginInfo));
});

app.post('/oauth/huawei/register', async (c) => {
	const loginInfo = await huaweiAccountService.register(c, await c.req.json());
	return c.json(result.ok(loginInfo));
});
