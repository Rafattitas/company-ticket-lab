const express = require('express');
const { parseId } = require('./operations');
const clean = (value) => typeof value === 'string' ? value.trim() : '';
function createContentRouters(pool, authentication) {
 const templates = express.Router(); const knowledge = express.Router();
 const manage = authentication.requirePermission('accounts:manage');
 const update = authentication.requirePermission('tickets:update');
 for (const router of [templates,knowledge]) router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 templates.get('/all',manage,async(req,res,next)=>{try {res.json({templates:(await pool.query('SELECT id,title,body,active,updated_at FROM reply_templates ORDER BY title,id LIMIT 100')).rows});}catch(error){next(error);}});
 templates.get('/',update,async(req,res,next)=>{try {res.json({templates:(await pool.query('SELECT id,title,body FROM reply_templates WHERE active = TRUE ORDER BY title,id LIMIT 100')).rows});}catch(error){next(error);}});
 for (const method of ['post','put']) templates[method](method==='post'?'/':'/:id',manage,async(req,res,next)=>{
  const title=clean(req.body?.title),body=clean(req.body?.body),id=parseId(req.params.id);
  if(title.length<2||title.length>120||!body||body.length>5000||typeof req.body?.active!=='boolean'||(method==='put'&&!id)) return res.status(400).json({error:'invalid_template'});
  try {const result=await pool.query(method==='post'?'INSERT INTO reply_templates(title,body,active) VALUES ($1,$2,$3) RETURNING id,title,body,active,updated_at':'UPDATE reply_templates SET title=$1,body=$2,active=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING id,title,body,active,updated_at',method==='post'?[title,body,req.body.active]:[title,body,req.body.active,id]);
   if(!result.rowCount)return res.status(404).json({error:'template_not_found'});res.status(method==='post'?201:200).json({template:result.rows[0]});
  }catch(error){next(error);}
 });
 async function list(req,res,next,admin=false){
  const search=clean(req.query.search),page=Number(req.query.page||1);
  if(search.length>120||!Number.isInteger(page)||page<1||page>10000)return res.status(400).json({error:'invalid_search'});
  try {const where=`${admin?'TRUE':'published = TRUE'} AND (title ILIKE $1 OR body ILIKE $1 OR category ILIKE $1)`;
   const [items,total]=await Promise.all([pool.query(`SELECT id,title,category,${admin?'body,published,':'left(body,180) AS excerpt,'}updated_at FROM knowledge_articles WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 20 OFFSET $2`,[`%${search}%`,(page-1)*20]),pool.query(`SELECT count(*)::integer AS total FROM knowledge_articles WHERE ${where}`,[`%${search}%`])]);
   res.json({articles:items.rows,total:total.rows[0].total,page,page_size:20});
  }catch(error){next(error);}
 }
 knowledge.get('/admin',manage,(req,res,next)=>list(req,res,next,true));
 knowledge.get('/',(req,res,next)=>list(req,res,next));
 knowledge.get('/:id',async(req,res,next)=>{
  const id=parseId(req.params.id);if(!id)return res.status(404).json({error:'article_not_found'});
  try {const result=await pool.query('SELECT id,title,category,body,updated_at FROM knowledge_articles WHERE id=$1 AND published = TRUE',[id]);if(!result.rowCount)return res.status(404).json({error:'article_not_found'});res.json({article:result.rows[0]});}catch(error){next(error);}
 });
 for (const method of ['post','put']) knowledge[method](method==='post'?'/':'/:id',manage,async(req,res,next)=>{
  const title=clean(req.body?.title),body=clean(req.body?.body),category=clean(req.body?.category)||'General',id=parseId(req.params.id);
  if(title.length<3||title.length>200||body.length<10||body.length>20000||category.length>80||typeof req.body?.published!=='boolean'||(method==='put'&&!id))return res.status(400).json({error:'invalid_article'});
  try {const result=await pool.query(method==='post'?'INSERT INTO knowledge_articles(title,body,category,published) VALUES($1,$2,$3,$4) RETURNING id,title,body,category,published,updated_at':'UPDATE knowledge_articles SET title=$1,body=$2,category=$3,published=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING id,title,body,category,published,updated_at',method==='post'?[title,body,category,req.body.published]:[title,body,category,req.body.published,id]);
   if(!result.rowCount)return res.status(404).json({error:'article_not_found'});res.status(method==='post'?201:200).json({article:result.rows[0]});
  }catch(error){next(error);}
 });
 return {templates,knowledge};
}
module.exports={createContentRouters};
