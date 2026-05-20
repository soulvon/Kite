DevinAutomationService']=void 0x0;
const _0x36fd90=_0x2af218(_0x2bd1ba(0x2471)),_0xd5ca97=_0x2bd1ba(0x2342);
class _0x562204 extends Error{

}
class _0x2dc54b{
static ['DEVIN_APP_URL']='https://app.devin.ai';
static ['DEFAULT_PROMPT']='每天运行一次，检查项目状态并输出简短中文摘要。这是用于研究 Devin Automations 协议的测试表单内容。';
static ['DEFAULT_NAME_PREFIX']='Daily Sandbox Audit';
static ['MAX_CONCURRENCY']=0x1e;
['getHttpsAgent'](){
return(0x0,_0xd5ca97['getSystemHttpsAgent'])();

}
['getAuth1Token'](_0x14d85c){
return[_0x14d85c['devin_auth1_token'],_0x14d85c['refresh_token'],_0x14d85c['cachedRefreshToken']]['find'](_0xc3da2=>!!_0xc3da2&&_0xc3da2['startsWith']('auth1_'));

}
['asRecord'](_0x323c56){
return _0x323c56&&'object'==typeof _0x323c56&&!Array['isArray'](_0x323c56)?_0x323c56:{

}
;

}
['dollarsToMicros'](_0x292e61){
if(null==_0x292e61)return;
let _0xd6b335;
if('string'==typeof _0x292e61){
const _0x99d88e=_0x292e61['replace'](/[$,\s]/g,'');
if(!_0x99d88e)return;
_0xd6b335=Number(_0x99d88e);

}
else _0xd6b335=Number(_0x292e61);
return Number['isFinite'](_0xd6b335)?Math['round'](0xf4240*_0xd6b335):void 0x0;

}
['pickFirstMicros'](_0x56a9f5){
for(const _0x5ce98c of _0x56a9f5)if(Number['isFinite'](_0x5ce98c))return _0x5ce98c;

}
['formatMicros'](_0x3efb15){
return Number['isFinite'](_0x3efb15)?'$'+((_0x3efb15||0x0)/0xf4240)['toFixed'](0x2):'--';

}
['localTimeToUtcRrule'](_0x4f3e45,_0x2a21bd,_0x364a01){
return'FREQ=DAILY;
BYHOUR='+((_0x4f3e45-_0x364a01)%0x18+0x18)%0x18+';
BYMINUTE='+_0x2a21bd;

}
['buildPayload'](_0x518f2d){
const _0x5728d6=Number['isFinite'](_0x518f2d['hour'])?Number(_0x518f2d['hour']):0x9,_0x41f2bf=Number['isFinite'](_0x518f2d['minute'])?Number(_0x518f2d['minute']):0x0,_0x222438=Number['isFinite'](_0x518f2d['tzOffsetHours'])?Number(_0x518f2d['tzOffsetHours']):0x8,_0xaa5281=_0x518f2d['prompt']||_0x2dc54b['DEFAULT_PROMPT'];
return{
'name':(_0x518f2d['namePrefix']||_0x2dc54b['DEFAULT_NAME_PREFIX'])+' '+new Date()['toTimeString']()['slice'](0x0,0x8)['replace'](/:/g,''),'triggers':[{
'event_type':'schedule:recurring','conditions':[[{
'field':'rrule','operator':'matches','value':this['localTimeToUtcRrule'](_0x5728d6,_0x41f2bf,_0x222438)
}
]]
}
],'actions':[{
'type':'start_session','prompt':_0xaa5281,'rich_content':[{
'text':_0xaa5281
}
]
}
],'enabled':!0x0,'max_acu_limit':null,'invocation_limit':0x32,'invocation_limit_window_seconds':0xe10,'linear_tools_enabled':!0x0,'net_policy':{
'allow':[{
'hostname':'git-manager.devin.ai'
}
]
}
,'devin_mode':null
}
;

}
async['devinApi'](_0x2d5dda,_0x241be1,_0x338643,_0x5b48c8,_0x4b89d5,_0x4dad31){
const _0x3a1bd6={
'accept':'application/json'
}
;
void 0x0!==_0x4b89d5&&(_0x3a1bd6['content-type']='application/json'),_0x338643&&(_0x3a1bd6['authorization']='Bearer '+_0x338643),_0x5b48c8&&(_0x3a1bd6['x-cog-org-id']=_0x5b48c8);
const _0xf9bd00=this['getHttpsAgent'](),_0x24368d=await(0x0,_0xd5ca97['withRetry'])(()=>_0x36fd90['default']['request']({
'url':''+_0x2dc54b['DEVIN_APP_URL']+_0x241be1,'method':_0x2d5dda,'headers':_0x3a1bd6,'data':_0x4b89d5,'timeout':0xafc8,'proxy':!0x1,'signal':_0x4dad31,'validateStatus':_0xf09642=>_0xf09642<0x1f4,..._0xf9bd00&&{
'httpsAgent':_0xf9bd00
}

}
),0x1,0x4b0);
return{
'ok':_0x24368d['status']>=0xc8&&_0x24368d['status']<0x12c,'status':_0x24368d['status'],'data':_0x24368d['data']
}
;

}
['isAuthFailed'](_0x16d918){
return 0x191===_0x16d918['status']||0x193===_0x16d918['status'];

}
['ensureOk'](_0x1a06e0,_0x5b6313){
if(this['isAuthFailed'](_0x1a06e0))throw new _0x562204(_0x5b6313+' token失效');
if(!_0x1a06e0['ok'])throw new Error(_0x5b6313+'失败: '+_0x1a06e0['status']+' '+('string'==typeof _0x1a06e0['data']?_0x1a06e0['data']:JSON['stringify'](_0x1a06e0['data'])['slice'](0x0,0x12c)));
return _0x1a06e0['data'];

}
async['resolveOrg'](_0x51510f,_0x28e9d7,_0x4b6a12){
if(_0x28e9d7&&_0x28e9d7['startsWith']('org-'))return{
'orgId':_0x28e9d7
}
;
const _0x5efe48=await this['devinApi']('POST','/api/users/post-auth',_0x51510f,void 0x0,{
'pathname':'/','search':''
}
,_0x4b6a12);
if(this['isAuthFailed'](_0x5efe48))throw new _0x562204('post-auth token失效');
if(_0x5efe48['ok']){
const _0x4d6e98=this['asRecord'](_0x5efe48['data']);
if(_0x4d6e98['org_id'])return{
'orgId':String(_0x4d6e98['org_id']),'orgName':_0x4d6e98['org_name']?String(_0x4d6e98['org_name']):void 0x0
}
;

}
const _0x41304c=await this['devinApi']('GET','/api/users/current-membership',_0x51510f,void 0x0,void 0x0,_0x4b6a12);
if(this['isAuthFailed'](_0x41304c))throw new _0x562204('current-membership token失效');
if(_0x41304c['ok']){
const _0x559ed4=this['asRecord'](this['asRecord'](_0x41304c['data'])['org']);
if(_0x559ed4['org_id'])return{
'orgId':String(_0x559ed4['org_id']),'orgName':_0x559ed4['name']?String(_0x559ed4['name']):void 0x0
}
;

}
const _0x6de085=await this['devinApi']('GET','/api/organizations',_0x51510f,void 0x0,void 0x0,_0x4b6a12);
if(this['isAuthFailed'](_0x6de085))throw new _0x562204('organizations token失效');
if(_0x6de085['ok']&&Array['isArray'](_0x6de085['data'])&&_0x6de085['data']['length']>0x0){
const _0x1b7ea1=this['asRecord'](_0x6de085['data'][0x0]);
if(_0x1b7ea1['org_id'])return{
'orgId':String(_0x1b7ea1['org_id']),'orgName':_0x1b7ea1['name']?String(_0x1b7ea1['name']):void 0x0
}
;

}
throw new Error('无法解析 Devin 组织');

}
async['checkCreditStatus'](_0x3af712,_0x1b10d4,_0x1a0250){
const [_0x4c223b,_0x23199f,_0x3c5cb9]=await Promise['all']([this['devinApi']('GET','/api/'+_0x1b10d4+'/billing/status',_0x3af712,_0x1b10d4,void 0x0,_0x1a0250),this['devinApi']('GET','/api/billing/checklist-credit-status',_0x3af712,_0x1b10d4,void 0x0,_0x1a0250),this['devinApi']('GET','/api/billing/subscription',_0x3af712,_0x1b10d4,void 0x0,_0x1a0250)]);
if(this['isAuthFailed'](_0x4c223b)||this['isAuthFailed'](_0x23199f)||this['isAuthFailed'](_0x3c5cb9))throw new _0x562204('credit status token失效');
const _0x83a1e4=_0x4c223b['ok']?this['asRecord'](_0x4c223b['data']):{

}
,_0x428861=_0x23199f['ok']?this['asRecord'](_0x23199f['data']):{

}
,_0x58d8f0=_0x3c5cb9['ok']?this['asRecord'](_0x3c5cb9['data']):{

}
,_0x1acad0=this['asRecord'](_0x428861['granted']),_0x10065e=this['asRecord'](_0x428861['completion']),_0x59d5eb=this['pickFirstMicros']([this['dollarsToMicros'](_0x83a1e4['overage_credits']),this['dollarsToMicros'](_0x83a1e4['overage_balance']),this['dollarsToMicros'](_0x83a1e4['extra_usage_balance']),this['dollarsToMicros'](_0x83a1e4['available_credits']),this['dollarsToMicros'](_0x58d8f0['credit_balance'])]),_0x798540=Number(_0x1acad0['automations']);
return{
'overageBalanceMicros':_0x59d5eb,'overageCredits':void 0x0!==_0x59d5eb?_0x59d5eb/0xf4240:void 0x0,'automationsGranted':Number['isFinite'](_0x798540)?_0x798540:void 0x0,'automationsCompletion':!0x0===_0x10065e['automations']||'true'===String(_0x10065e['automations'])['toLowerCase'](),'unit':_0x428861['unit']?String(_0x428861['unit']):void 0x0
}
;

}
async['skipGitOnboarding'](_0x279ba3,_0x55e24e,_0x567d17){
this['ensureOk'](await this['devinApi']('PUT','/api/users/info',_0x279ba3,_0x55e24e,{
'devin_onboarding_git_page':'skipped'
}
,_0x567d17),'跳过 onboarding');

}
async['createAutomation'](_0xc5456,_0x28fc86,_0x24a68b,_0x248938){
const _0x5f231c=this['ensureOk'](await this['devinApi']('POST','/api/'+_0x28fc86+'/automations',_0xc5456,_0x28fc86,_0x24a68b,_0x248938),'创建 automation'),_0x2549c9=this['asRecord'](_0x5f231c);
return{
'automationId':_0x2549c9['automation_id']?String(_0x2549c9['automation_id']):_0x2549c9['id']?String(_0x2549c9['id']):void 0x0
}
;

}
['makeUpdate'](_0x47fdf2,_0x27b732,_0x3223f4){
const _0x4163c0=_0x47fdf2['filter'](_0x4cd0b9=>'success'===_0x4cd0b9['status']||'skipped'===_0x4cd0b9['status']||'failed'===_0x4cd0b9['status'])['length'];
return{
'running':_0x27b732,'total':_0x47fdf2['length'],'completed':_0x4163c0,'created':_0x47fdf2['filter'](_0x10bcfa=>_0x10bcfa['created'])['length'],'skipped':_0x47fdf2['filter'](_0x239ee6=>'skipped'===_0x239ee6['status'])['length'],'failed':_0x47fdf2['filter'](_0x4ed1c8=>'failed'===_0x4ed1c8['status'])['length'],'results':_0x47fdf2['map'](_0x23d9a5=>({
..._0x23d9a5
}
)),'message':_0x3223f4
}
;

}
async['processAccount'](_0x22e594,_0x448fa5,_0x191908,_0x21ddd7){
const _0x3d7766=this['getAuth1Token'](_0x22e594);
if(!_0x3d7766)return _0x448fa5['status']='skipped',void(_0x448fa5['summary']='跳过：无 auth1 token');
_0x448fa5['status']='checking',_0x448fa5['summary']='查询 Extra';
const _0x5bac87=await this['resolveOrg'](_0x3d7766,_0x22e594['devin_primary_org_id']||_0x22e594['cachedDevinPrimaryOrgId'],_0x21ddd7);
_0x448fa5['orgId']=_0x5bac87['orgId'],_0x448fa5['orgName']=_0x5bac87['orgName'];
const _0x4b1f1f=await this['checkCreditStatus'](_0x3d7766,_0x5bac87['orgId'],_0x21ddd7);
if(_0x448fa5['beforeOverageMicros']=_0x4b1f1f['overageBalanceMicros'],_0x448fa5['automationsGranted']=_0x4b1f1f['automationsGranted'],void 0x0===_0x4b1f1f['overageBalanceMicros'])return _0x448fa5['status']='skipped',void(_0x448fa5['summary']='跳过：未确认 Extra');
if(_0x4b1f1f['overageBalanceMicros']>0x0)return _0x448fa5['status']='skipped',void(_0x448fa5['summary']='跳过：Extra '+this['formatMicros'](_0x4b1f1f['overageBalanceMicros']));
if(_0x4b1f1f['automationsCompletion']||void 0x0!==_0x4b1f1f['automationsGranted']&&_0x4b1f1f['automationsGranted']>0x0)return _0x448fa5['status']='skipped',void(_0x448fa5['summary']=('跳过：Automations 已给过 '+(_0x4b1f1f['automationsGranted']??''))['trim']());
_0x448fa5['status']='creating',_0x448fa5['summary']='创建 automation',await this['skipGitOnboarding'](_0x3d7766,_0x5bac87['orgId'],_0x21ddd7);
const _0x4480a3=await this['createAutomation'](_0x3d7766,_0x5bac87['orgId'],_0x191908,_0x21ddd7);
_0x448fa5['automationId']=_0x4480a3['automationId'],_0x448fa5['created']=!0x0;
const _0x166a85=await this['checkCreditStatus'](_0x3d7766,_0x5bac87['orgId'],_0x21ddd7);
_0x448fa5['afterOverageMicros']=_0x166a85['overageBalanceMicros'],_0x448fa5['automationsGranted']=_0x166a85['automationsGranted'],_0x448fa5['status']='success',_0x448fa5['summary']='已创建：Extra '+this['formatMicros'](_0x166a85['overageBalanceMicros']);

}
async['runBatch'](_0x102cd6,_0x18c9e2={

}
,_0x13293f,_0xa39a5b){
const _0x1c8a6f=Math['max'](0x1,Math['min'](Number(_0x18c9e2['concurrency']||0x5),_0x2dc54b['MAX_CONCURRENCY'])),_0x4a2021=this['buildPayload'](_0x18c9e2),_0x53bbb8=_0x102cd6['map'](_0x12385c=>({
'accountId':_0x12385c['id'],'email':_0x12385c['email'],'status':'pending','summary':'等待'
}
));
let _0x47256b=0x0;
const _0x3bc3dd=(_0x39d13e,_0xa7f518=!0x0)=>_0x13293f?.(this['makeUpdate'](_0x53bbb8,_0xa7f518,_0x39d13e));
_0x3bc3dd('准备开始');
const _0x3854a9=async()=>{
for(;
;
){
const _0x2c5d82=_0x47256b++;
if(_0x2c5d82>=_0x102cd6['length'])return;
const _0x2f4880=_0x102cd6[_0x2c5d82],_0x379e85=_0x53bbb8[_0x2c5d82];
try{
await this['processAccount'](_0x2f4880,_0x379e85,_0x4a2021,_0xa39a5b);

}
catch(_0x56c747){
_0x379e85['status']='failed',_0x379e85['error']=_0x56c747 instanceof _0x562204?'token失效，请先刷新余额或重新导入账号 token':_0x56c747?.['message']||String(_0x56c747),_0x379e85['summary']='失败';

}
_0x3bc3dd(_0x2c5d82+0x1+'/'+_0x102cd6['length']+' '+_0x2f4880['email']);

}

}
;
await Promise['all'](Array['from']({
'length':Math['min'](_0x1c8a6f,_0x102cd6['length'])
}
,()=>_0x3854a9()));
const _0x2b62a8=this['makeUpdate'](_0x53bbb8,!0x1,'完成');
return _0x13293f?.(_0x2b62a8),_0x2b62a8;

}

}
_0x1ac64d['DevinAutomationService']=_0x2dc54b;

}
,0x1968:(_0x11536b,_0x3fcbee,_0x434f17)=>{
'use strict';
var _0x2aded3=_0x434f17(0x1b68)['parse'],_0x5664e1={
'ftp':0x15,'gopher':0x46,'http':0x50,'https':0x1bb,'ws':0x50,'wss':0x1bb
}
,_0x216727=String['prototype']['endsWith']||function(_0x2f63ab){
return _0x2f63ab['length']<=this['length']&&-0x1!==this['indexOf'](_0x2f63ab,this['length']-_0x2f63ab['length']);

}
;
function _0x247818(_0x1a00ac){
return process['env'][_0x1a00ac['toLowerCase']()]||process['env'][_0x1a00ac['toUpperCase']()]||'';

}
_0x3fcbee['getProxyForUrl']=function(_0xd822d7){
var _0x3b87af='string'==typeof _0xd822d7?_0x2aded3(_0xd822d7):_0xd822d7||{

}
,_0x1fbc2b=_0x3b87af['protocol'],_0x41a55f=_0x3b87af['host'],_0x53949d=_0x3b87af['port'];
if('string'!=typeof _0x41a55f||!_0x41a55f||'string'!=typeof _0x1fbc2b)return'';
if(_0x1fbc2b=_0x1fbc2b['split'](':',0x1)[0x0],!function(_0x40b854,_0x4f9fdb){
var _0x3c3ab7=(_0x247818('npm_config_no_proxy')||_0x247818('no_proxy'))['toLowerCase']();
return!_0x3c3ab7||'*'!==_0x3c3ab7&&_0x3c3ab7['split'](/[,\s]/)['every'](function(_0x460838){
if(!_0x460838)return!0x0;
var _0x435d27=_0x460838['match'](/^(.+):(\d+)$/),_0x350959=_0x435d27?_0x435d27[0x1]:_0x460838,_0x3d299d=_0x435d27?parseInt(_0x435d27[0x2]):0x0;
return!(!_0x3d299d||_0x3d299d===_0x4f9fdb)||(/^[.*]/['test'](_0x350959)?('*'===_0x350959['charAt'](0x0)&&(_0x350959=_0x350959['slice'](0x1)),!_0x216727['call'](_0x40b854,_0x350959)):_0x40b854!==_0x350959);

}
);

}
(_0x41a55f=_0x41a55f['replace'](/:\d*$/,''),_0x53949d=parseInt(_0x53949d)||_0x5664e1[_0x1fbc2b]||0x0))return'';
var _0x3fed80=_0x247818('npm_config_'+_0x1fbc2b+'_proxy')||_0x247818(_0x1fbc2b+'_proxy')||_0x247818('npm_config_proxy')||_0x247818('all_proxy');
return _0x3fed80&&-0x1===_0x3fed80['indexOf']('://')&&(_0x3fed80=_0x1fbc2b+'://'+_0x3fed80),_0x3fed80;

}
;

}
,0x1995:_0x593cac=>{
'use strict';
_0x593cac['exports']=Object['getOwnPropertyDescriptor'];

}
,0x19b9:_0x15851e=>{
var _0x210cba=0x3e8,_0x19ce2e=0x3c*_0x210cba,_0x4d27eb=0x3c*_0x19ce2e,_0x5b5842=0x18*_0x4d27eb,_0x596ce7=0x7*_0x5b5842;
function _0x2c3ced(_0x6a9308,_0xd6a783,_0x1ae889,_0x39548b){
var _0x2eecc1=_0xd6a783>=1.5*_0x1ae889;
return Math['round'](_0x6a9308/_0x1ae889)+' '+_0x39548b+(_0x2eecc1?'s':'');

}
_0x15851e['exports']=function(_0x1c9173,_0x283942){
_0x283942=_0x283942||{

}
;
var _0x4e0b80,_0x3e88df,_0x547d76=typeof _0x1c9173;
if('string'===_0x547d76&&_0x1c9173['length']>0x0)return function(_0x45a91f){
if(!((_0x45a91f=String(_0x45a91f))['length']>0x64)){
var _0x36dd9d=/^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i['exec'](_0x45a91f);
if(_0x36dd9d){
var _0x194c6c=parseFloat(_0x36dd9d[0x1]);
switch((_0x36dd9d[0x2]||'ms')['toLowerCase']()){
case'years':case'year':case'yrs':case'yr':case'y':return 0x758fac300*_0x194c6c;
case'weeks':case'week':case'w':return _0x194c6c*_0x596ce7;
case'days':case'day':case'd':return _0x194c6c*_0x5b5842;
case'hours':case'hour':case'hrs':case'hr':case'h':return _0x194c6c*_0x4d27eb;
case'minutes':case'minute':case'mins':case'min':case'm':return _0x194c6c*_0x19ce2e;
case'seconds':case'second':case'secs':case'sec':case's':return _0x194c6c*_0x210cba;
case'milliseconds':case'millisecond':case'msecs':case'msec':case'ms':return _0x194c6c;
default:return;

}

}

}

}
(_0x1c9173);
if('number'===_0x547d76&&isFinite(_0x1c9173))return _0x283942['long']?(_0x4e0b80=_0x1c9173,(_0x3e88df=Math['abs'](_0x4e0b80))>=_0x5b5842?_0x2c3ced(_0x4e0b80,_0x3e88df,_0x5b5842,'day'):_0x3e88df>=_0x4d27eb?_0x2c3ced(_0x4e0b80,_0x3e88df,_0x4d27eb,'hour'):_0x3e88df>=_0x19ce2e?_0x2c3ced(_0x4e0b80,_0x3e88df,_0x19ce2e,'minute'):_0x3e88df>=_0x210cba?_0x2c3ced(_0x4e0b80,_0x3e88df,_0x210cba,'second'):_0x4e0b80+' ms'):function(_0x54269a){
var _0x19d9ae=Math['abs'](_0x54269a);
return _0x19d9ae>=_0x5b5842?Math['round'](_0x54269a/_0x5b5842)+'d':_0x19d9ae>=_0x4d27eb?Math['round'](_0x54269a/_0x4d27eb)+'h':_0x19d9ae>=_0x19ce2e?Math['round'](_0x54269a/_0x19ce2e)+'m':_0x19d9ae>=_0x210cba?Math['round'](_0x54269a/_0x210cba)+'s':_0x54269a+'ms';

}
(_0x1c9173);
throw new Error('val is not a non-empty string or a valid number. val='+JSON['stringify'](_0x1c9173));

}
;

}
,0x1a57:(_0x5d6f17,_0x7b8263,_0x54badf)=>{
'use strict';
var _0x5c77bf=_0x54badf(0x2489);
_0x5d6f17['exports']=Function['prototype']['bind']||_0x5c77bf;

}
,0x1b10:_0x3b1fb3=>{
'use strict';
_0x3b1fb3['exports']=require('path');

}
,0x1b46:_0x43cb29=>{
'use strict';
_0x43cb29['exports']=require('crypto');

}
,0x1b68:_0x3b2011=>{
'use strict';
_0x3b2011['exports']=require('url');

}
,0x1bcf:_0x214c55=>{
'use strict';
_0x214c55['exports']='undefined'!=typeof Reflect&&Reflect&&Reflect['apply'];

}
,0x1c08:(_0x354e51,_0x15b9f4,_0x49765c)=>{
'use strict';
var _0x4a16ad,_0x442c76=_0x49765c(0xc36),_0x3eec6e=_0x49765c(0x16a3);
try{
_0x4a16ad=[]['__proto__']===Array['prototype'];

}
catch(_0x2d30f1){
if(!_0x2d30f1||'object'!=typeof _0x2d30f1||!('code'in _0x2d30f1)||'ERR_PROTO_ACCESS'!==_0x2d30f1['code'])throw _0x2d30f1;

}
var _0x4821b1=!!_0x4a16ad&&_0x3eec6e&&_0x3eec6e(Object['prototype'],'__proto__'),_0x1fbadb=Object,_0x1b4ee5=_0x1fbadb['getPrototypeOf'];
_0x354e51['exports']=_0x4821b1&&'function'==typeof _0x4821b1['get']?_0x442c76([_0x4821b1['get']]):'function'==typeof _0x1b4ee5&&function(_0x3d9fbe){
return _0x1b4ee5(null==_0x3d9fbe?_0x3d9fbe:_0x1fbadb(_0x3d9fbe));

}
;

}
,0x1d2d:(_0x188005,_0x36791b,_0x51852f)=>{
'use strict';
_0x51852f(0x243e);
var _0x4305e5,_0x44d0ee=_0x51852f(0x1294),_0x4feb03=_0x51852f(0x21a3),_0x5c426a=_0x51852f(0x163c),_0x1d383f=_0x51852f(0x1152),_0x1fd171=(_0x51852f(0xa35),_0x51852f(0x233f));
function _0x54bcf8(_0x2618ca){
var _0x57dc7b=this;
_0x57dc7b['options']=_0x2618ca||{

}
,_0x57dc7b['proxyOptions']=_0x57dc7b['options']['proxy']||{

}
,_0x57dc7b['maxSockets']=_0x57dc7b['options']['maxSockets']||_0x4feb03['Agent']['defaultMaxSockets'],_0x57dc7b['requests']=[],_0x57dc7b['sockets']=[],_0x57dc7b['on']('free',function(_0x4b5083,_0x3f84e7,_0x112fbe,_0xebf6c1){
for(var _0xf9f789=_0x2a377d(_0x3f84e7,_0x112fbe,_0xebf6c1),_0x2a5ee1=0x0,_0x114a94=_0x57dc7b['requests']['length'];
_0x2a5ee1<_0x114a94;
++_0x2a5ee1){
var _0x3b570a=_0x57dc7b['requests'][_0x2a5ee1];
if(_0x3b570a['host']===_0xf9f789['host']&&_0x3b570a['port']===_0xf9f789['port'])return _0x57dc7b['requests']['splice'](_0x2a5ee1,0x1),void _0x3b570a['request']['onSocket'](_0x4b5083);

}
_0x4b5083['destroy'](),_0x57dc7b['removeSocket'](_0x4b5083);

}
);

}
function _0x7d3d39(_0x23d3f4,_0x240112){
var _0x40c06a=this;
_0x54bcf8['prototype']['createSocket']['call'](_0x40c06a,_0x23d3f4,function(_0x361d73){
var _0x22d3ad=_0x23d3f4['request']['getHeader']('host'),_0x19547d=_0x36c4da({

}
,_0x40c06a['options'],{
'socket':_0x361d73,'servername':_0x22d3ad?_0x22d3ad['replace'](/:.*$/,''):_0x23d3f4['host']
}
),_0x10a106=_0x44d0ee['connect'](0x0,_0x19547d);
_0x40c06a['sockets'][_0x40c06a['sockets']['indexOf'](_0x361d73)]=_0x10a106,_0x240112(_0x10a106);

}
);

}
function _0x2a377d(_0x3877fd,_0x13324e,_0x10493a){
return'string'==typeof _0x3877fd?{
'host':_0x3877fd,'port':_0x13324e,'localAddress':_0x10493a
}
:_0x3877fd;

}
function _0x36c4da(_0x2e9143){
for(var _0x179432=0x1,_0x38db13=arguments['length'];
_0x179432<_0x38db13;
++_0x179432){
var _0x3b1aa7=arguments[_0x179432];
if('object'==typeof _0x3b1aa7)for(var _0x2152ee=Object['keys'](_0x3b1aa7),_0x5bb751=0x0,_0x128680=_0x2152ee['length'];
_0x5bb751<_0x128680;
++_0x5bb751){
var _0x56275c=_0x2152ee[_0x5bb751];
void 0x0!==_0x3b1aa7[_0x56275c]&&(_0x2e9143[_0x56275c]=_0x3b1aa7[_0x56275c]);

}

}
return _0x2e9143;

}
_0x36791b['httpOverHttp']=function(_0x303e21){
var _0x4cfdfc=new _0x54bcf8(_0x303e21);
return _0x4cfdfc['request']=_0x4feb03['request'],_0x4cfdfc;

}
,_0x36791b['httpsOverHttp']=function(_0x48a79b){
var _0xb4e890=new _0x54bcf8(_0x48a79b);
return _0xb4e890['request']=_0x4feb03['request'],_0xb4e890['createSocket']=_0x7d3d39,_0xb4e890['defaultPort']=0x1bb,_0xb4e890;

}
,_0x36791b['httpOverHttps']=function(_0x5945c6){
var _0x539b96=new _0x54bcf8(_0x5945c6);
return _0x539b96['request']=_0x5c426a['request'],_0x539b96;

}
,_0x36791b['httpsOverHttps']=function(_0x394433){
var _0x53b171=new _0x54bcf8(_0x394433);
return _0x53b171['request']=_0x5c426a['request'],_0x53b171['createSocket']=_0x7d3d39,_0x53b171['defaultPort']=0x1bb,_0x53b171;

}
,_0x1fd171['inherits'](_0x54bcf8,_0x1d383f['EventEmitter']),_0x54bcf8['prototype']['addRequest']=function(_0x2a2d34,_0x263e69,_0x2c99c1,_0x2b94e6){
var _0x4be636=this,_0x4a6de6=_0x36c4da({
'request':_0x2a2d34
}
,_0x4be636['options'],_0x2a377d(_0x263e69,_0x2c99c1,_0x2b94e6));
_0x4be636['sockets']['length']>=this['maxSockets']?_0x4be636['requests']['push'](_0x4a6de6):_0x4be636['createSocket'](_0x4a6de6,function(_0x4f097f){
function _0x5536a6(){
_0x4be636['emit']('free',_0x4f097f,_0x4a6de6);

}
function _0x394030(_0x4aeabd){
_0x4be636['removeSocket'](_0x4f097f),_0x4f097f['removeListener']('free',_0x5536a6),_0x4f097f['removeListener']('close',_0x394030),_0x4f097f['removeListener']('agentRemove',_0x394030);

}
_0x4f097f['on']('free',_0x5536a6),_0x4f097f['on']('close',_0x394030),_0x4f097f['on']('agentRemove',_0x394030),_0x2a2d34['onSocket'](_0x4f097f);

}
);

}
,_0x54bcf8['prototype']['createSocket']=function(_0xbecc6c,_0x163f30){
var _0x3ed2bd=this,_0x5149bb={

}
;
_0x3ed2bd['sockets']['push'](_0x5149bb);
var _0x14e4b5=_0x36c4da({

}
,_0x3ed2bd['proxyOptions'],{
'method':'CONNECT','path':_0xbecc6c['host']+':'+_0xbecc6c['port'],'agent':!0x1,'headers':{
'host':_0xbecc6c['host']+':'+_0xbecc6c['port']
}

}
);
_0xbecc6c['localAddress']&&(_0x14e4b5['localAddress']=_0xbecc6c['localAddress']),_0x14e4b5['proxyAuth']&&(_0x14e4b5['headers']=_0x14e4b5['headers']||{

}
,_0x14e4b5['headers']['Proxy-Authorization']='Basic '+new Buffer(_0x14e4b5['proxyAuth'])['toString']('base64')),_0x4305e5('making CONNECT request');
var _0x3ee996=_0x3ed2bd['request'](_0x14e4b5);
function _0x19b47f(_0x1ce2ce,_0x397230,_0x44ab2d){
var _0x3aa381;
return _0x3ee996['removeAllListeners'](),_0x397230['removeAllListeners'](),0xc8!==_0x1ce2ce['statusCode']?(_0x4305e5('tunneling socket could not be established, statusCode=%d',_0x1ce2ce['statusCode']),_0x397230['destroy'](),(_0x3aa381=new Error('tunneling socket could not be established, statusCode='+_0x1ce2ce['statusCode']))['code']='ECONNRESET',_0xbecc6c['request']['emit']('error',_0x3aa381),void _0x3ed2bd['removeSocket'](_0x5149bb)):_0x44ab2d['length']>0x0?(_0x4305e5('got illegal response body from proxy'),_0x397230['destroy'](),(_0x3aa381=new Error('got illegal response body from proxy'))['code']='ECONNRESET',_0xbecc6c['request']['emit']('error',_0x3aa381),void _0x3ed2bd['removeSocket'](_0x5149bb)):(_0x4305e5('tunneling connection has established'),_0x3ed2bd['sockets'][_0x3ed2bd['sockets']['indexOf'](_0x5149bb)]=_0x397230,_0x163f30(_0x397230));

}
_0x3ee996['useChunkedEncodingByDefault']=!0x1,_0x3ee996['once']('response',function(_0xca47e4){
_0xca47e4['upgrade']=!0x0;

}
),_0x3ee996['once']('upgrade',function(_0x3ffaa2,_0x10a742,_0x651430){
process['nextTick'](function(){
_0x19b47f(_0x3ffaa2,_0x10a742,_0x651430);

}
);

}
),_0x3ee996['once']('connect',_0x19b47f),_0x3ee996['once']('error',function(_0x242fb1){
_0x3ee996['removeAllListeners'](),_0x4305e5('tunneling socket could not be established, cause=%s
',_0x242fb1['message'],_0x242fb1['stack']);
var _0x5ee917=new Error('tunneling socket could not be established, cause='+_0x242fb1['message']);
_0x5ee917['code']='ECONNRESET',_0xbecc6c['request']['emit']('error',_0x5ee917),_0x3ed2bd['removeSocket'](_0x5149bb);

}
),_0x3ee996['end']();

}
,_0x54bcf8['prototype']['removeSocket']=function(_0x88cdd){
var _0x49bd18=this['sockets']['indexOf'](_0x88cdd);
if(-0x1!==_0x49bd18){
this['sockets']['splice'](_0x49bd18,0x1);
var _0xe7bc13=this['requests']['shift']();
_0xe7bc13&&this['createSocket'](_0xe7bc13,function(_0x5ceb61){
_0xe7bc13['request']['onSocket'](_0x5ceb61);

}
);

}

}
,_0x4305e5=process['env']['NODE_DEBUG']&&/\btunnel\b/['test'](process['env']['NODE_DEBUG'])?function(){
var _0x599527=Array['prototype']['slice']['call'](arguments);
'string'==typeof _0x599527[0x0]?_0x599527[0x0]='TUNNEL: '+_0x599527[0x0]:_0x599527['unshift']('TUNNEL:');

}
:function(){

}
,_0x36791b['debug']=_0x4305e5;

}
,0x1d53:(_0x51557d,_0x5daf02,_0x482e65)=>{
var _0x42b567;
_0x51557d['exports']=function(){
if(!_0x42b567){
try{
_0x42b567=_0x482e65(0x1679)('follow-redirects');

}
catch(_0x472b9b){

}
'function'!=typeof _0x42b567&&(_0x42b567=function(){

}
);

}
_0x42b567['apply'](null,arguments);

}
;

}
,0x1dae:(_0x40382e,_0xb6886f,_0x18229e)=>{
_0x40382e['exports']=_0x18229e(0x1062);

}
,0x1e07:(_0x2f48ae,_0x1777a2,_0x3a64de)=>{
'use strict';
const _0x160067=_0x3a64de(0x359),_0x23880b=_0x3a64de(0x16fc),_0x3f521f=process['env'];
let _0x16c1b6;
function _0x63ba61(_0x30a9ca){
const _0x2a5925=function(_0x29c94c){
if(!0x1===_0x16c1b6)return 0x0;
if(_0x23880b('color=16m')||_0x23880b('color=full')||_0x23880b('color=truecolor'))return 0x3;
if(_0x23880b('color=256'))return 0x2;
if(_0x29c94c&&!_0x29c94c['isTTY']&&!0x0!==_0x16c1b6)return 0x0;
const _0x226da9=_0x16c1b6?0x1:0x0;
if('win32'===process['platform']){
const _0x8de217=_0x160067['release']()['split']('.');
return Number(process['versions']['node']['split']('.')[0x0])>=0x8&&Number(_0x8de217[0x0])>=0xa&&Number(_0x8de217[0x2])>=0x295a?Number(_0x8de217[0x2])>=0x3a53?0x3:0x2:0x1;

}
if('CI'in _0x3f521f)return['TRAVIS','CIRCLECI','APPVEYOR','GITLAB_CI']['some'](_0x1525f2=>_0x1525f2 in _0x3f521f)||'codeship'===_0x3f521f['CI_NAME']?0x1:_0x226da9;
if('TEAMCITY_VERSION'in _0x3f521f)return/^(9\.(0*[1-9]\d*)\.|\d{
2,
}
\.)/['test'](_0x3f521f['TEAMCITY_VERSION'])?0x1:0x0;
if('truecolor'===_0x3f521f['COLORTERM'])return 0x3;
if('TERM_PROGRAM'in _0x3f521f){
const _0x54caf1=parseInt((_0x3f521f['TERM_PROGRAM_VERSION']||'')['split']('.')[0x0],0xa);
switch(_0x3f521f['TERM_PROGRAM']){
case'iTerm.app':return _0x54caf1>=0x3?0x3:0x2;
case'Apple_Terminal':return 0x2;

}

}
return/-256(color)?$/i['test'](_0x3f521f['TERM'])?0x2:/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i['test'](_0x3f521f['TERM'])||'COLORTERM'in _0x3f521f?0x1:(_0x3f521f['TERM'],_0x226da9);

}
(_0x30a9ca);
return function(_0x39d390){
return 0x0!==_0x39d390&&{
'level':_0x39d390,'hasBasic':!0x0,'has256':_0x39d390>=0x2,'has16m':_0x39d390>=0x3
}
;

}
(_0x2a5925);

}
_0x23880b('no-color')||_0x23880b('no-colors')||_0x23880b('color=false')?_0x16c1b6=!0x1:(_0x23880b('color')||_0x23880b('colors')||_0x23880b('color=true')||_0x23880b('color=always'))&&(_0x16c1b6=!0x0),'FORCE_COLOR'in _0x3f521f&&(_0x16c1b6=0x0===_0x3f521f['FORCE_COLOR']['length']||0x0!==parseInt(_0x3f521f['FORCE_COLOR'],0xa)),_0x2f48ae['exports']={
'supportsColor':_0x63ba61,'stdout':_0x63ba61(process['stdout']),'stderr':_0x63ba61(process['stderr'])
}
;

}
,0x1e99:(_0x1ffb39,_0x401ee7,_0x15da87)=>{
_0x401ee7['formatArgs']=function(_0x1484a9){
if(_0x1484a9[0x0]=(this['useColors']?'%c':'')+this['namespace']+(this['useColors']?' %c':' ')+_0x1484a9[0x0]+(this['useColors']?'%c ':' ')+'+'+_0x1ffb39['exports']['humanize'](this['diff']),!this['useColors'])return;
const _0x5dca66='color: '+this['color'];
_0x1484a9['splice'](0x1,0x0,_0x5dca66,'color: inherit');
let _0x156fc7=0x0,_0xd5e04d=0x0;
_0x1484a9[0x0]['replace'](/%[a-zA-Z%]/g,_0x398da8=>{
'%%'!==_0x398da8&&(_0x156fc7++,'%c'===_0x398da8&&(_0xd5e04d=_0x156fc7));

}
),_0x1484a9['splice'](_0xd5e04d,0x0,_0x5dca66);

}
,_0x401ee7['save']=function(_0x174134){
try{
_0x174134?_0x401ee7['storage']['setItem']('debug',_0x174134):_0x401ee7['storage']['removeItem']('debug');

}
catch(_0x59639){

}

}
,_0x401ee7['load']=function(){
let _0x33214d;
try{
_0x33214d=_0x401ee7['storage']['getItem']('debug')||_0x401ee7['storage']['getItem']('DEBUG');

}
catch(_0x5d24cc){

}
return!_0x33214d&&'undefined'!=typeof process&&'env'in process&&(_0x33214d=process['env']['DEBUG']),_0x33214d;

}
,_0x401ee7['useColors']=function(){
if('undefined'!=typeof window&&window['process']&&('renderer'===window['process']['type']||window['process']['__nwjs']))return!0x0;
if('undefined'!=typeof navigator&&navigator['userAgent']&&navigator['userAgent']['toLowerCase']()['match'](/(edge|trident)\/(\d+)/))return!0x1;
let _0x4d2187;
return'undefined'!=typeof document&&document['documentElement']&&document['documentElement']['style']&&document['documentElement']['style']['WebkitAppearance']||'undefined'!=typeof window&&window['console']&&(window['console']['firebug']||window['console']['exception']&&window['console']['table'])||'undefined'!=typeof navigator&&navigator['userAgent']&&(_0x4d2187=navigator['userAgent']['toLowerCase']()['match'](/firefox\/(\d+)/))&&parseInt(_0x4d2187[0x1],0xa)>=0x1f||'undefined'!=typeof navigator&&navigator['userAgent']&&navigator['userAgent']['toLowerCase']()['match'](/applewebkit\/(\d+)/);

}
,_0x401ee7['storage']=(function(){
try{
return localStorage;

}
catch(_0x404175){

}

}
()),_0x401ee7['destroy']=((()=>{
let _0x5108b9=!0x1;
return()=>{
_0x5108b9||(_0x5108b9=!0x0);

}
;

}
)()),_0x401ee7['colors']=['#0000CC','#0000FF','#0033CC','#0033FF','#0066CC','#0066FF','#0099CC','#0099FF','#00CC00','#00CC33','#00CC66','#00CC99','#00CCCC','#00CCFF','#3300CC','#3300FF','#3333CC','#3333FF','#3366CC','#3366FF','#3399CC','#3399FF','#33CC00','#33CC33','#33CC66','#33CC99','#33CCCC','#33CCFF','#6600CC','#6600FF','#6633CC','#6633FF','#66CC00','#66CC33','#9900CC','#9900FF','#9933CC','#9933FF','#99CC00','#99CC33','#CC0000','#CC0033','#CC0066','#CC0099','#CC00CC','#CC00FF','#CC3300','#CC3333','#CC3366','#CC3399','#CC33CC','#CC33FF','#CC6600','#CC6633','#CC9900','#CC9933','#CCCC00','#CCCC33','#FF0000','#FF0033','#FF0066','#FF0099','#FF00CC','#FF00FF','#FF3300','#FF3333','#FF3366','#FF3399','#FF33CC','#FF33FF','#FF6600','#FF6633','#FF9900','#FF9933','#FFCC00','#FFCC33'],_0x401ee7['log']=console['debug']||console['log']||(()=>{

}
),_0x1ffb39['exports']=_0x15da87(0x2e0)(_0x401ee7);
const {
formatters:_0x105c89
}
=_0x1ffb39['exports'];
_0x105c89['j']=function(_0x2e724e){
try{
return JSON['stringify'](_0x2e724e);

}
catch(_0x3a4647){
return'[UnexpectedJSONParseError]: '+_0x3a4647['message'];

}

}
;

}
,0x1f42:_0x16a8bd=>{
'use strict';
_0x16a8bd['exports']=Math['min'];

}
,0x1f46:(_0xdc7ca5,_0x15483e,_0x2eebdb)=>{
'use strict';
Object['defineProperty'](_0x15483e,'__esModule',{
'value':!0x0
}
),_0x15483e['DevinAutomationService']=_0x15483e['InstanceManager']=_0x15483e['WindsurfAutoLoginService']=_0x15483e['WindsurfPatchService']=_0x15483e['MachineIdManager']=_0x15483e['BalanceChecker']=_0x15483e['AccountManager']=_0x15483e['WindsurfApiService']=_0x15483e['FirebaseAuthService']=_0x15483e['getQuotaEffectiveRemainingPercent']=_0x15483e['hasQuotaOverageBalance']=_0x15483e['QuotaUsageInfo']=_0x15483e['MachineInfo']=_0x15483e['WindsurfAccount']=void 0x0;
var _0x2330b8=_0x2eebdb(0x18f);
Object['defineProperty'](_0x15483e,'WindsurfAccount',{
'enumerable':!0x0,'get':function(){
return _0x2330b8['WindsurfAccount'];

}

}
),Object['defineProperty'](_0x15483e,'MachineInfo',{
'enumerable':!0x0,'get':function(){
return _0x2330b8['MachineInfo'];

}

}
),Object['defineProperty'](_0x15483e,'QuotaUsageInfo',{
'enumerable':!0x0,'get':function(){
return _0x2330b8['QuotaUsageInfo'];

}

}
),Object['defineProperty'](_0x15483e,'hasQuotaOverageBalance',{
'enumerable':!0x0,'get':function(){
return _0x2330b8['hasQuotaOverageBalance'];

}

}
),Object['defineProperty'](_0x15483e,'getQuotaEffectiveRemainingPercent',{
'enumerable':!0x0,'get':function(){
return _0x2330b8['getQuotaEffectiveRemainingPercent'];

}

}
);
var _0x166673=_0x2eebdb(0x22cc);
Object['defineProperty'](_0x15483e,'FirebaseAuthService',{
'enumerable':!0x0,'get':function(){
return _0x166673['FirebaseAuthService'];

}

}
);
var _0x472ef4=_0x2eebdb(0x21f1);
Object['defineProperty'](_0x15483e,'WindsurfApiService',{
'enumerable':!0x0,'get':function(){
return _0x472ef4['WindsurfApiService'];

}

}
);
var _0xe12191=_0x2eebdb(0x26de);
Object['defineProperty'](_0x15483e,'AccountManager',{
'enumerable':!0x0,'get':function(){
return _0xe12191['AccountManager'];

}

}
);
var _0x2a0909=_0x2eebdb(0x2b3);
Object['defineProperty'](_0x15483e,'BalanceChecker',{
'enumerable':!0x0,'get':function(){
return _0x2a0909['BalanceChecker'];

}

}
);
var _0x3ca754=_0x2eebdb(0x173f);
Object['defineProperty'](_0x15483e,'MachineIdManager',{
'enumerable':!0x0,'get':function(){
return _0x3ca754['MachineIdManager'];

}

}
);
var _0x1cc3d7=_0x2eebdb(0x1063);
Object['defineProperty'](_0x15483e,'WindsurfPatchService',{
'enumerable':!0x0,'get':function(){
return _0x1cc3d7['WindsurfPatchService'];

}

}
);
var _0x18c8a5=_0x2eebdb(0x14d5);
Object['defineProperty'](_0x15483e,'WindsurfAutoLoginService',{
'enumerable':!0x0,'get':function(){
return _0x18c8a5['WindsurfAutoLoginService'];

}

}
);
var _0xe31441=_0x2eebdb(0x141c);
Object['defineProperty'](_0x15483e,'InstanceManager',{
'enumerable':!0x0,'get':function(){
return _0xe31441['InstanceManager'];

}

}
);
var _0x3eba69=_0x2eebdb(0x18c2);
Object['defineProperty'](_0x15483e,'DevinAutomationService',{
'enumerable':!0x0,'get':function(){
return _0x3eba69['DevinAutomationService'];

}

}
);

}
,0x1f73:(_0xa24ee2,_0x44c149,_0x58d6d9)=>{
var _0x12691a=_0x58d6d9(0x909),_0x40bd7f=_0x58d6d9(0x11cb);
_0xa24ee2['exports']=function(_0x41f9f9,_0xa50b5f,_0x11a8bc,_0x2bf3b8){
var _0x46935e=_0x11a8bc['keyedList']?_0x11a8bc['keyedList'][_0x11a8bc['index']]:_0x11a8bc['index'];
_0x11a8bc['jobs'][_0x46935e]=function(_0x435030,_0x340261,_0x132726,_0x2c3b5){
return 0x2==_0x435030['length']?_0x435030(_0x132726,_0x12691a(_0x2c3b5)):_0x435030(_0x132726,_0x340261,_0x12691a(_0x2c3b5));

}
(_0xa50b5f,_0x46935e,_0x41f9f9[_0x46935e],function(_0x50df8d,_0x9a3793){
_0x46935e in _0x11a8bc['jobs']&&(delete _0x11a8bc['jobs'][_0x46935e],_0x50df8d?_0x40bd7f(_0x11a8bc):_0x11a8bc['results'][_0x46935e]=_0x9a3793,_0x2bf3b8(_0x50df8d,_0x11a8bc['results']));

}
);

}
;

}
,0x1f84:_0x216c51=>{
'use strict';
_0x216c51['exports']=SyntaxError;

}
,0x1f85:(_0x1d149b,_0x2316a8,_0x4d0517)=>{
var _0x2f5506=_0x4d0517(0x89b)['Stream'],_0x51093f=_0x4d0517(0x233f);
function _0x576c87(){
this['source']=null,this['dataSize']=0x0,this['maxDataSize']=0x100000,this['pauseStream']=!0x0,this['_maxDataSizeExceeded']=!0x1,this['_released']=!0x1,this['_bufferedEvents']=[];

}
_0x1d149b['exports']=_0x576c87,_0x51093f['inherits'](_0x576c87,_0x2f5506),_0x576c87['create']=function(_0x3bcefc,_0x1b8c92){
var _0x43cceb=new this();
for(var _0x51e546 in _0x1b8c92=_0x1b8c92||{

}
)_0x43cceb[_0x51e546]=_0x1b8c92[_0x51e546];
_0x43cceb['source']=_0x3bcefc;
var _0x5cfede=_0x3bcefc['emit'];
return _0x3bcefc['emit']=function(){
return _0x43cceb['_handleEmit'](arguments),_0x5cfede['apply'](_0x3bcefc,arguments);

}
,_0x3bcefc['on']('error',function(){

}
),_0x43cceb['pauseStream']&&_0x3bcefc['pause'](),_0x43cceb;

}
,Object['defineProperty'](_0x576c87['prototype'],'readable',{
'configurable':!0x0,'enumerable':!0x0,'get':function(){
return this['source']['readable'];

}

}
),_0x576c87['prototype']['setEncoding']=function(){
return this['source']['setEncoding']['apply'](this['source'],arguments);

}
,_0x576c87['prototype']['resume']=function(){
this['_released']||this['release'](),this['source']['resume']();

}
,_0x576c87['prototype']['pause']=function(){
this['source']['pause']();

}
,_0x576c87['prototype']['release']=function(){
this['_released']=!0x0,this['_bufferedEvents']['forEach'](function(_0x4a3300){
this['emit']['apply'](this,_0x4a3300);

}
['bind'](this)),this['_bufferedEvents']=[];

}
,_0x576c87['prototype']['pipe']=function(){
var _0x19c545=_0x2f5506['prototype']['pipe']['apply'](this,arguments);
return this['resume'](),_0x19c545;

}
,_0x576c87['prototype']['_handleEmit']=function(_0x5ce937){
this['_released']?this['emit']['apply'](this,_0x5ce937):('data'===_0x5ce937[0x0]&&(this['dataSize']+=_0x5ce937[0x1]['length'],this['_checkIfMaxDataSizeExceeded']()),this['_bufferedEvents']['push'](_0x5ce937));

}
,_0x576c87['prototype']['_checkIfMaxDataSizeExceeded']=function(){
if(!(this['_maxDataSizeExceeded']||this['dataSize']<=this['maxDataSize'])){
this['_maxDataSizeExceeded']=!0x0;
var _0x20f01d='DelayedStream#maxDataSize of '+this['maxDataSize']+' bytes exceeded.';
this['emit']('error',new Error(_0x20f01d));

}

}
;

}
,0x21a3:_0x10e8d0=>{
'use strict';
_0x10e8d0['exports']=require('http');

}
,0x21c8:_0x1e7767=>{
'use strict';
_0x1e7767['exports']='undefined'!=typeof Reflect&&Reflect['getPrototypeOf']||null;

}
,0x21f1:function(_0x35f7fb,_0x4872cc,_0x31a417){
'use strict';
var _0x317ac4=this&&this['__importDefault']||function(_0x259113){
return _0x259113&&_0x259113['__esModule']?_0x259113:{
'default':_0x259113
}
;

}
;
Object['defineProperty'](_0x4872cc,'__esModule',{
'value':!0x0
}
),_0x4872cc['WindsurfApiService']=void 0x0;
const _0x23b8ed=_0x317ac4(_0x31a417(0x2471)),_0x4be0cd=_0x31a417(0x22cc),_0x5503a8=_0x31a417(0x860),_0x2112b0=_0x31a417(0x2342);
_0x4872cc['WindsurfApiService']=class{
static ['REGISTER_API_URL']='https://register.windsurf.com';
static ['API_SERVER_URL']='https://server.codeium.com';
static ['WINDSURF_BACKEND_URLS']=['https://web-backend.windsurf.com','https://windsurf.com/_backend'];
static ['PROXY_REGISTER_URL']='https://api.zenghongchao.xyz/proxy/windsurf/register';
static ['PROXY_USER_URL']='https://api.zenghongchao.xyz/proxy/windsurf/user';
static ['useProxy']=!0x1;
static ['LOGIN_TIMEOUT_MS']=0x7530;
static['setUseProxy'](_0x52f2dc){
this['useProxy']=_0x52f2dc;

}
static['getUseProxy'](){
return this['useProxy'];

}
static['getHttpsAgent'](){
return(0x0,_0x2112b0['getSystemHttpsAgent'])();

}
static async['registerUser'](_0x8af2e7,_0x506333){
try{
const _0x40129e=this['getHttpsAgent']();
(0x0,_0x5503a8['logAccountDebug'])('Windsurf RegisterUser: start',{
'tokenLen':(_0x8af2e7||'')['length'],'hasHttpsAgent':!!_0x40129e
}
);
const _0x10b609=Buffer['from'](_0x8af2e7,'utf8'),_0x908e7e=Buffer['concat']([Buffer['from']([0xa]),this['encodeVarint'](_0x10b609['length']),_0x10b609]),_0x4af96b={
'Content-Type':'application/proto','Connect-Protocol-Version':'1','User-Agent':'Mozilla/5.0 (Windows NT 10.0;
 Win64;
 x64) AppleWebKit/537.36'
}
,_0x477dbf=(0x0,_0x2112b0['withRetry'])(()=>_0x23b8ed['default']['post'](this['REGISTER_API_URL']+'/exa.seat_management_pb.SeatManagementService/RegisterUser',_0x908e7e,{
'headers':_0x4af96b,'responseType':'arraybuffer','proxy':!0x1,'timeout':0x2710,'signal':_0x506333,..._0x40129e&&{
'httpsAgent':_0x40129e
}

}
))['then'](_0x273d94=>({
'source':'direct','response':_0x273d94
}
));
let _0x4a0726;
if(this['useProxy']){
const _0x4cedb0=(0x0,_0x2112b0['withRetry'])(()=>_0x23b8ed['default']['post'](this['PROXY_REGISTER_URL'],_0x908e7e,{
'headers':_0x4af96b,'responseType':'arraybuffer','proxy':!0x1,'timeout':0x2710,'signal':_0x506333
}
))['then'](_0xeb30e=>({
'source':'proxy','response':_0xeb30e
}
));
try{
const _0x5a44a3=await Promise['any']([_0x4cedb0,_0x477dbf]);
_0x4a0726=_0x5a44a3['response'],(0x0,_0x5503a8['log'])('[WindsurfAPI] 竞速成功，使用: '+_0x5a44a3['source']),(0x0,_0x5503a8['logAccountDebug'])('Windsurf RegisterUser: success',{
'source':_0x5a44a3['source'],'status':_0x4a0726['status'],'bytes':_0x4a0726['data']?.['byteLength']??_0x4a0726['data']?.['length']
}
);

}
catch(_0x2a48d6){
const _0x357d51=_0x2a48d6['errors']||[];
throw(0x0,_0x5503a8['logAccountDebug'])('Windsurf RegisterUser: all failed',{
'errors':_0x357d51['map'](_0x53eb30=>({
'message':_0x53eb30?.['message'],'code':_0x53eb30?.['code'],'status':_0x53eb30?.['response']?.['status']
}
))
}
),new Error('反代和直连均失败: '+_0x357d51['map'](_0x54c79e=>_0x54c79e['message'])['join'](' / '));

}

}
else try{
_0x4a0726=(await _0x477dbf)['response'],(0x0,_0x5503a8['log'])('[WindsurfAPI] 直连成功 (proxy disabled)'),(0x0,_0x5503a8['logAccountDebug'])('Windsurf RegisterUser: success (direct)',{
'status':_0x4a0726['status'],'bytes':_0x4a0726['data']?.['byteLength']??_0x4a0726['data']?.['length']
}
);

}
catch(_0x42b0d4){
throw(0x0,_0x5503a8['logAccountDebug'])('Windsurf RegisterUser: direct failed',{
'message':_0x42b0d4?.['message'],'code':_0x42b0d4?.['code'],'status':_0x42b0d4?.['response']?.['status']
}
),new Error('直连失败: '+_0x42b0d4['message']);

}
const _0x9e80a1=Buffer['from'](_0x4a0726['data']),_0x2e1d1a=this['parseRegisterUserResponse'](_0x9e80a1),_0x1fa222=_0x2e1d1a['apiKey'],_0x5f4ae7=_0x2e1d1a['name'],_0x39e5c7=_0x2e1d1a['apiServerUrl'];
return _0x1fa222?{
'success':!0x0,'apiKey':_0x1fa222,'name':_0x5f4ae7,'apiServerUrl':_0x39e5c7||this['API_SERVER_URL']
}
:{
'success':!0x1,'error':'注册失败：未获取到 API Key'
}
;

}
catch(_0x17cc4f){
let _0x53cc65='Windsurf注册失败';
const _0x2019be=_0x17cc4f['response']?.['status'],_0x559d97=_0x17cc4f['response']?.['data']||{

}
;
return(0x0,_0x5503a8['logAccountDebug'])('Windsurf RegisterUser: error',{
'message':_0x17cc4f?.['message'],'code':_0x17cc4f?.['code'],'status':_0x2019be,'dataType':typeof _0x559d97,'data':_0x559d97
}
),0x191===_0x2019be||'unauthorized'===_0x559d97['message']?_0x53cc65='账号未授权（可能被封禁、过期或需要重新登录官网验证）':0x193===_0x2019be?_0x53cc65='账号被禁止访问':0x1ad===_0x2019be?_0x53cc65='请求过于频繁，请稍后重试':_0x559d97['message']?_0x53cc65='Windsurf: '+_0x559d97['message']:_0x559d97['code']?_0x53cc65='Windsurf: '+_0x559d97['code']:_0x17cc4f['message']&&(_0x53cc65='Windsurf: '+_0x17cc4f['message']),{
'success':!0x1,'error':_0x53cc65
}
;

}

}
static async['loginWithEmailPassword'](_0x4b46f0,_0x557b25){
return(0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithEmailPassword: start',{
'email':_0x4b46f0
}
),await(0x0,_0x2112b0['withAbortTimeout'])(this['LOGIN_TIMEOUT_MS'],'Windsurf登录('+_0x4b46f0+')',async _0x3fdcb3=>{
const _0x24d121=await _0x4be0cd['FirebaseAuthService']['signInWithEmailPassword'](_0x4b46f0,_0x557b25,!0x1,_0x3fdcb3);
if(!_0x24d121['success']||!_0x24d121['idToken'])return(0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithEmailPassword: firebase failed',{
'email':_0x4b46f0,'error':_0x24d121['error']
}
),{
'success':!0x1,'error':_0x24d121['error']||'Firebase 登录失败'
}
;
const _0x3d5346=await this['registerUser'](_0x24d121['idToken'],_0x3fdcb3);
return _0x3d5346['success']?((0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithEmailPassword: success',{
'email':_0x4b46f0,'hasApiKey':!!_0x3d5346['apiKey'],'apiServerUrl':_0x3d5346['apiServerUrl']
}
),{
'success':!0x0,'apiKey':_0x3d5346['apiKey'],'name':_0x3d5346['name']||_0x4b46f0,'apiServerUrl':_0x3d5346['apiServerUrl'],'refreshToken':_0x24d121['refreshToken']
}
):((0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithEmailPassword: register failed',{
'email':_0x4b46f0,'error':_0x3d5346['error']
}
),{
'success':!0x1,'error':_0x3d5346['error']||'Windsurf 注册失败'
}
);

}
);

}
static async['loginWithRefreshToken'](_0x44f591){
return(0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithRefreshToken: start'),await(0x0,_0x2112b0['withAbortTimeout'])(this['LOGIN_TIMEOUT_MS'],'Windsurf刷新登录',async _0x520895=>{
const _0x35758b=await _0x4be0cd['FirebaseAuthService']['refreshIdToken'](_0x44f591,_0x520895);
if(!_0x35758b['success']||!_0x35758b['idToken'])return(0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithRefreshToken: refresh failed',{
'error':_0x35758b['error']
}
),{
'success':!0x1,'error':_0x35758b['error']||'RefreshToken 刷新失败'
}
;
const _0x37bdfd=await this['registerUser'](_0x35758b['idToken'],_0x520895);
return _0x37bdfd['success']?((0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithRefreshToken: success',{
'hasApiKey':!!_0x37bdfd['apiKey']
}
),{
'success':!0x0,'apiKey':_0x37bdfd['apiKey'],'name':_0x37bdfd['name'],'apiServerUrl':_0x37bdfd['apiServerUrl']
}
):((0x0,_0x5503a8['logAccountDebug'])('Windsurf loginWithRefreshToken: register failed',{
'error':_0x37bdfd['error']
}
),{
'success':!0x1,'error':_0x37bdfd['error']||'Windsurf 注册失败'
}
);

}
);

}
static async['getPrimaryApiKeyForDevinSession'](_0x44ff52){
return await(0x0,_0x2112b0['withAbortTimeout'])(this['LOGIN_TIMEOUT_MS'],'Devin Session 获取 API Key',async _0x1ae1f6=>{
try{
if(!_0x44ff52||!_0x44ff52['startsWith']('devin-session-token$'))return{
'success':!0x1,'error':'无效的 Devin Session Token'
}
;
const _0x57dbc4=this['getHttpsAgent'](),_0x4e4021=Buffer['from'](_0x44ff52,'utf8'),_0x331bd7=Buffer['concat']([Buffer['from']([0xa]),this['encodeVarint'](_0x4e4021['length']),_0x4e4021]);
let _0x26232d,_0x2e6336;
for(const _0x236969 of this['WINDSURF_BACKEND_URLS'])try{
_0x26232d=await(0x0,_0x2112b0['withRetry'])(()=>_0x23b8ed['default']['post'](_0x236969+'/exa.seat_management_pb.SeatManagementService/GetPrimaryApiKeyForDevsOnly',_0x331bd7,{
'headers':{
'Content-Type':'application/proto','Accept':'*/*','Connect-Protocol-Version':'1','Origin':'https://windsurf.com','Referer':'https://windsurf.com/','User-Agent':'Mozilla/5.0 (Windows NT 10.0;
 Win64;
 x64) AppleWebKit/537.36','x-auth-token':_0x44ff52,'x-devin-session-token':_0x44ff52
}
,'responseType':'arraybuffer','proxy':!0x1,'timeout':0x2710,'signal':_0x1ae1f6,..._0x57dbc4&&{
'httpsAgent':_0x57dbc4
}

}
)),(0x0,_0x5503a8['logAccountDebug'])('Windsurf getPrimaryApiKeyForDevinSession: success',{
'baseUrl':_0x236969,'status':_0x26232d['status'],'bytes':_0x26232d['data']?.['byteLength']??_0x26232d['data']?.['length']
}
);
break;

}
catch(_0x40fd0b){
_0x2e6336=_0x40fd0b,(0x0,_0x5503a8['logAccountDebug'])('Windsurf getPrimaryApiKeyForDevinSession: endpoint failed',{
'baseUrl':_0x236969,'message':_0x40fd0b?.['message'],'code':_0x40fd0b?.['code'],'status':_0x40fd0b?.['response']?.['status']
}
);

}
if(!_0x26232d)throw _0x2e6336||new Error('GetPrimaryApiKeyForDevsOnly 请求失败');
let _0x27fd9f=Buffer['from'](_0x26232d['data']);
_0x27fd9f['length']>0x5&&0x0===_0x27fd9f[0x0]&&(_0x27fd9f=_0x27fd9f['slice'](0x5));
const _0x4f646b=this['parseRegisterUserResponse'](_0x27fd9f),_0x1be00b=_0x27fd9f['toString']('utf8'),_0x2cc67e=_0x4f646b['apiKey']||_0x1be00b['match'](/sk-ws-[A-Za-z0-9._-]+/)?.[0x0]||'';
return _0x2cc67e?{
'success':!0x0,'apiKey':_0x2cc67e,'apiServerUrl':this['API_SERVER_URL']
}
:{
'success':!0x1,'error':'GetPrimaryApiKeyForDevsOnly 未返回 API Key'
}
;

}
catch(_0x485baa){
const _0x5a2321=_0x485baa['response']?.['status'],_0x20486d=_0x485baa['response']?.['data']?Buffer['from'](_0x485baa['response']['data'])['toString']('utf8'):_0x485baa['message']||String(_0x485baa);
return(0x0,_0x5503a8['logAccountDebug'])('Windsurf getPrimaryApiKeyForDevinSession: failed',{
'status':_0x5a2321,'message':_0x20486d
}
),{
'success':!0x1,'error':_0x5a2321?'HTTP '+_0x5a2321+': '+_0x20486d:_0x20486d
}
;

}

}
);

}
static async['getOneTimeAuthTokenForDevinSession'](_0x214e29,_0x4f70df){
return await(0x0,_0x2112b0['withAbortTimeout'])(this['LOGIN_TIMEOUT_MS'],'Devin Session 获取一次性登录票据',async _0x32fd5b=>{
try{
if(!_0x214e29||!_0x214e29['startsWith']('devin-session-token$'))return{
'success':!0x1,'error':'无效的 Devin Session Token'
}
;
const _0x24c3c3=this['getHttpsAgent'](),_0x4359c8=Buffer['from'](_0x214e29,'utf8'),_0x453875=Buffer['concat']([Buffer['from']([0xa]),this['encodeVarint'](_0x4359c8['length']),_0x4359c8]);
let _0x51911e,_0x594bb5;
for(const _0x15e109 of this['WINDSURF_BACKEND_URLS'])try{
const _0xa04b46={
'Content-Type':'application/proto','Accept':'*/*','Connect-Protocol-Version':'1','Origin':'https://windsurf.com','Referer':'https://windsurf.com/','User-Agent':'Windsurf/1.4.2','x-auth-token':_0x214e29,'x-devin-session-token':_0x214e29
}
;
_0x4f70df?.['auth1Token']&&(_0xa04b46['x-devin-auth1-token']=_0x4f70df['auth1Token']),_0x4f70df?.['accountId']&&(_0xa04b46['x-devin-account-id']=_0x4f70df['accountId']),_0x4f70df?.['primaryOrgId']&&(_0xa04b46['x-devin-primary-org-id']=_0x4f70df['primaryOrgId']),_0x51911e=await(0x0,_0x2112b0['withRetry'])(()=>_0x23b8ed['default']['post'](_0x15e109+'/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken',_0x453875,{
'headers':_0xa04b46,'responseType':'arraybuffer','proxy':!0x1,'timeout':0x2710,'signal':_0x32fd5b,..._0x24c3c3&&{
'httpsAgent':_0x24c3c3
}

}
)),(0x0,_0x5503a8['logAccountDebug'])('Windsurf getOneTimeAuthTokenForDevinSession: success',{
'baseUrl':_0x15e109,'status':_0x51911e['status'],'bytes':_0x51911e['data']?.['byteLength']??_0x51911e['data']?.['length']
}
);
break;

}
catch(_0x59c392){
_0x594bb5=_0x59c392,(0x0,_0x5503a8['logAccountDebug'])('Windsurf getOneTimeAuthTokenForDevinSession: endpoint failed',{
'baseUrl':_0x15e109,'message':_0x59c392?.['message'],'code':_0x59c392?.['code'],'status':_0x59c392?.['response']?.['status']
}
);

}
if(!_0x51911e)throw _0x594bb5||new Error('GetOneTimeAuthToken 请求失败');
let _0x225dd5=Buffer['from'](_0x51911e['data']);
_0x225dd5['length']>0x5&&0x0===_0x225dd5[0x0]&&(_0x225dd5=_0x225dd5['slice'](0x5));
const _0x381b8e=this['parseFirstStringField'](_0x225dd5,0x1);
return _0x381b8e?{
'success':!0x0,'authToken':_0x381b8e
}
:{
'success':!0x1,'error':'GetOneTimeAuthToken 未返回 auth_token'
}
;

}
catch(_0x49069f){
const _0x3ae943=_0x49069f['response']?.['status'],_0x4f2d48=_0x49069f['response']?.['data']?Buffer['from'](_0x49069f['response']['data'])['toString']('utf8'):_0x49069f['message']||String(_0x49069f);
return(0x0,_0x5503a8['logAccountDebug'])('Windsurf getOneTimeAuthTokenForDevinSession: failed',{
'status':_0x3ae943,'message':_0x4f2d48
}
),{
'success':!0x1,'error':_0x3ae943?'HTTP '+_0x3ae943+': '+_0x4f2d48:_0x4f2d48
}
;

}

}
);

}
static['encodeVarint'](_0x3c2d53){
const _0x5f312f=[];
for(;
_0x3c2d53>0x7f;
)_0x5f312f['push'](0x7f&_0x3c2d53|0x80),_0x3c2d53>>>=0x7;
return _0x5f312f['push'](0x7f&_0x3c2d53),Buffer['from'](_0x5f312f);

}
static['parseRegisterUserResponse'](_0x5c06b6){
const _0x5ee72f={
'apiKey':'','name':'','apiServerUrl':''
}
;
let _0x4a16e5=0x0;
for(;
_0x4a16e5<_0x5c06b6['length'];
){
const _0x48f8ef=_0x5c06b6[_0x4a16e5++],_0x3a4738=_0x48f8ef>>0x3;
if(0x2!=(0x7&_0x48f8ef))break;
{
let _0x101c51=0x0,_0x184a02=0x0;
for(;
_0x4a16e5<_0x5c06b6['length'];
){
const _0x5f5453=_0x5c06b6[_0x4a16e5++];
if(_0x101c51|=(0x7f&_0x5f5453)<<_0x184a02,!(0x80&_0x5f5453))break;
_0x184a02+=0x7;

}
const _0xd93ee5=_0x5c06b6['slice'](_0x4a16e5,_0x4a16e5+_0x101c51)['toString']('utf8');
switch(_0x4a16e5+=_0x101c51,_0x3a4738){
case 0x1:_0x5ee72f['apiKey']=_0xd93ee5;
break;
case 0x2:_0x5ee72f['name']=_0xd93ee5;
break;
case 0x3:_0x5ee72f['apiServerUrl']=_0xd93ee5;

}

}

}
return _0x5ee72f;

}
static['parseFirstStringField'](_0x334b7a,_0x27013c){
let _0x445171=0x0;
for(;
_0x445171<_0x334b7a['length'];
){
const _0x27aa13=_0x334b7a[_0x445171++],_0x5943a9=_0x27aa13>>0x3,_0x57a236=0x7&_0x27aa13;
if(0x2===_0x57a236){
let _0xbc17b8=0x0,_0xe20dfa=0x0;
for(;
_0x445171<_0x334b7a['length'];
){
const _0x4cc1de=_0x334b7a[_0x445171++];
if(_0xbc17b8|=(0x7f&_0x4cc1de)<<_0xe20dfa,!(0x80&_0x4cc1de))break;
_0xe20dfa+=0x7;

}
const _0xa64e1=_0x334b7a['slice'](_0x445171,_0x445171+_0xbc17b8)['toString']('utf8');
if(_0x445171+=_0xbc17b8,_0x5943a9===_0x27013c&&_0xa64e1)return _0xa64e1;

}
else{
if(0x0!==_0x57a236)break;
for(;
_0x445171<_0x334b7a['length']&&0x80&_0x334b7a[_0x445171++];
);

}

}
return'';

}

}
;

}
,0x225e:(_0x348c64,_0x2b60de,_0x8cc663)=>{
var _0x99ed19=_0x8cc663(0x1f73),_0x15960a=_0x8cc663(0x251c),_0x3dc796=_0x8cc663(0x1884);
_0x348c64['exports']=function(_0x3ef359,_0x40c6ee,_0x387da9){
for(var _0x563e4c=_0x15960a(_0x3ef359);
_0x563e4c['index']<(_0x563e4c['keyedList']||_0x3ef359)['length'];
)_0x99ed19(_0x3ef359,_0x40c6ee,_0x563e4c,function(_0x415dfa,_0x3ec972){
_0x415dfa?_0x387da9(_0x415dfa,_0x3ec972):0x0!==Object['keys'](_0x563e4c['jobs'])['length']||_0x387da9(null,_0x563e4c['results']);

}
),_0x563e4c['index']++;
return _0x3dc796['bind'](_0x563e4c,_0x387da9);

}
;

}
,0x22cc:function(_0x35de65,_0x274f70,_0x55f8db){
'use strict';
var _0x327088=this&&this['__importDefault']||function(_0x2786c3){
retu