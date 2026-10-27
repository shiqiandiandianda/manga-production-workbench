export type FailureInfo={message:string;code:string;status:number;retryable:boolean;retryAfterMs:number;requestId?:string};
export function providerFailure(status:number,error:{code?:string;type?:string;message?:string},retryAfter:string|null,requestId?:string,now=Date.now()):FailureInfo {
  const code=error.code||error.type||'provider_error';
  const quota=error.type==='insufficient_quota'||/billing|credit|quota|spend_limit|usage_limit/.test(code);
  let message='模型服务请求失败，请稍后重试。';
  const requestedTooLarge=/request too large/i.test(error.message||'');
  if(code==='billing_not_active')message='本机使用的 OpenAI API 计费尚未启用，暂时无法拆解和出图。请由使用者在 API 账单页启用计费后继续；这不是请求频繁，也不是程序登录问题。';
  else if(code==='credit_balance_exhausted')message='OpenAI API 预付余额已用完。请在 API 账单页补充余额后继续拆解；这与点击次数无关。';
  else if(['organization_spend_limit_exceeded','project_spend_limit_exceeded'].includes(code))message='OpenAI API 已达到组织或项目消费上限。请检查 API 限额设置后继续；重复点击不会恢复额度。';
  else if(code==='organization_usage_limit_exceeded')message='OpenAI API 已达到组织使用额度，需要在 API 限额页处理后继续。';
  else if(quota)message='OpenAI API 余额或额度不足。请检查 API 账单和限额设置；这与点击次数无关。';
  else if(requestedTooLarge)message='本次内容超过当前模型的单次速率额度，单击也可能出现。请检查模型的令牌额度。';
  else if(status===429)message='OpenAI 接口暂时限流，单次请求也可能受令牌或共享额度限制。工作台会等待后继续。';
  else if(status===503)message='模型服务暂时繁忙，工作台会等待后继续。';
  else if(status===401)message='OpenAI 密钥验证失败，请检查服务端密钥配置。';
  else if(code==='model_not_found'||status===403)message='当前 API 项目无法使用配置的模型，请检查模型权限。';
  const seconds=retryAfter&&/^\d+(\.\d+)?$/.test(retryAfter)?Number(retryAfter):NaN;
  const date=retryAfter?Date.parse(retryAfter):NaN;
  const delay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?Math.max(0,date-now):10000;
  return {message,code:requestedTooLarge?'request_too_large':code,status,retryable:!quota&&!requestedTooLarge&&(status===429||status===503),retryAfterMs:Math.max(1000,delay),requestId};
}
export class ModelFailure extends Error {
  providerConfirmed=true;
  info:FailureInfo;
  constructor(info:FailureInfo){super(info.message);this.name='ModelFailure';this.info=info;}
}
