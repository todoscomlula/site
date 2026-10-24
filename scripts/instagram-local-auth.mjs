import {createServer} from 'node:http';
import {generateKeyPairSync,randomBytes,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {MetaClient} from './instagram-publishing/meta-client.mjs';
import {PublishingError} from './instagram-publishing/core.mjs';

export async function connectLocalInstagram({credentialPath='.cache/instagram-direct/credentials.json'}={}) {
  execFileSync('git',['check-ignore','--quiet',credentialPath],{stdio:'ignore'});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const route='/'+randomBytes(32).toString('hex');let tunnel;let complete;let reject;
  const connected=new Promise((yes,no)=>{complete=yes;reject=no;});
  const server=createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!==route){res.writeHead(404).end();return;}
    try {
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error();chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(body.key,'base64'));
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(body.iv,'base64'));decipher.setAuthTag(Buffer.from(body.tag,'base64'));
      const credentials=JSON.parse(Buffer.concat([decipher.update(Buffer.from(body.ciphertext,'base64')),decipher.final()]).toString('utf8'));
      const graph=new MetaClient(credentials);await graph.verifyAccount();
      await mkdir('.cache/instagram-direct',{recursive:true,mode:0o700});
      await writeFile(credentialPath,JSON.stringify(credentials),{mode:0o600});
      res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}',()=>complete(credentials));
    } catch {res.writeHead(400).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const timer=setTimeout(()=>reject(new PublishingError('LOCAL_AUTH_TIMEOUT')),180000);
  try {
    const tunnelUrl=await Promise.race([new Promise((resolve,no)=>{
      tunnel=spawn('cloudflared',['tunnel','--no-autoupdate','--url','http://127.0.0.1:'+server.address().port],{stdio:['ignore','pipe','pipe']});
      const inspect=data=>{const match=data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match)resolve(match[0]);};
      tunnel.stdout.on('data',inspect);tunnel.stderr.on('data',inspect);tunnel.once('error',no);tunnel.once('exit',()=>no(new PublishingError('LOCAL_AUTH_TUNNEL_FAILED')));
    }),connected]);
    execFileSync('gh',['workflow','run','instagram-local-auth.yml','--repo','todoscomlula/site','--ref','main','-f','callback='+tunnelUrl+route,'-f','public_key='+Buffer.from(publicKey).toString('base64')],{stdio:['ignore','pipe','pipe'],timeout:30000});
    console.log(JSON.stringify({mode:'local-auth-connecting',credentialsPrinted:false}));
    return await connected;
  } finally {clearTimeout(timer);server.closeAllConnections();server.close();tunnel?.kill('SIGTERM');}
}
