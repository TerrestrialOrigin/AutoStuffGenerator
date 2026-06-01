/* eslint-disable */
// @ts-nocheck
/* ============================================================
   AUTO-DUNGEON — procedural generator (headless, data-only).

   Ported verbatim from the original RollDvantage app. The body is
   loose, untyped JS (hence @ts-nocheck + eslint-disable); the public
   entry point `generateDungeon` carries a real typed signature so
   consumers get types from dungeon-types.ts.

   generateDungeon(seed, level, mode) -> a self-contained DungeonResult
   JSON object. No DOM, no rendering, no side effects beyond the RNG.
   ============================================================ */
import { RPG } from './data';
import { RPGGen } from './rpg-gen';
import type { DungeonMode, DungeonResult } from './dungeon-types';

/* ---------------- seeded RNG (mulberry32) ---------------- */
export function mulberry32(a: number): () => number {
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

var CELL = 24;

/* complexity levels — grid scales with level so the map always fills
   the same page area; rooms (and secrets) grow with level. */
function levelSpec(L){
  L = Math.max(1, Math.min(6, L|0 || 3));
  var specs = {
    1:{ gw:14, gh:15, rooms:[1,3],   rw:[4,7], rh:[4,6], secretMax:1 },
    2:{ gw:18, gh:20, rooms:[4,6],   rw:[3,6], rh:[3,5], secretMax:1 },
    3:{ gw:23, gh:25, rooms:[7,10],  rw:[3,6], rh:[3,5], secretMax:2 },
    4:{ gw:28, gh:30, rooms:[11,14], rw:[3,5], rh:[3,5], secretMax:3 },
    5:{ gw:33, gh:36, rooms:[15,19], rw:[3,5], rh:[2,4], secretMax:4 },
    6:{ gw:38, gh:41, rooms:[20,26], rw:[2,5], rh:[2,4], secretMax:5 }
  };
  var s = specs[L]; s.level = L; return s;
}

/* allowed content modes; anything else falls back to 'full' */
var MODES = { empty:1, full:1, detailed:1 };

/* ============================================================
   GENERATION  ->  returns a plain JSON-able dungeon object
   ============================================================ */
export function generateDungeon(seed: number, level?: number, mode?: DungeonMode): DungeonResult {
  // input robustness: a non-finite seed becomes a deterministic default (0);
  // an unknown/missing mode becomes 'full'; level is clamped inside levelSpec.
  seed = (typeof seed === 'number' && isFinite(seed)) ? (seed >>> 0) : 0;
  mode = MODES[mode] ? mode : 'full';
  var spec = levelSpec(level);
  var GW = spec.gw, GH = spec.gh, L = spec.level;
  var rng = mulberry32(seed);
  function ri(a,b){ return a + Math.floor(rng()*(b-a+1)); }
  function rint(n){ return Math.floor(rng()*n); }
  function pick(a){ return a[rint(a.length)]; }
  function chance(p){ return rng() < p; }
  function shuffle(a){ for(var i=a.length-1;i>0;i--){ var j=rint(i+1),t=a[i];a[i]=a[j];a[j]=t;} return a; }

  var floor = []; for(var y=0;y<GH;y++){ floor.push(new Array(GW).fill(0)); }
  function isFloor(x,y){ return x>=0&&y>=0&&x<GW&&y<GH&&floor[y][x]===1; }
  function ck(x,y){ return y*GW+x; }

  /* ---- rooms ---- */
  var rooms = [];
  function overlaps(r){
    if(r.x<1||r.y<1||r.x+r.w>GW-1||r.y+r.h>GH-1) return true;
    for(var i=0;i<rooms.length;i++){
      var o=rooms[i];
      if(r.x-1 < o.x+o.w && r.x+r.w+1 > o.x && r.y-1 < o.y+o.h && r.y+r.h+1 > o.y) return true;
    }
    return false;
  }
  var target = ri(spec.rooms[0], spec.rooms[1]), tries=0, maxTries=Math.max(800, target*250);
  while(rooms.length<target && tries<maxTries){
    tries++;
    var rw=ri(spec.rw[0],spec.rw[1]), rh=ri(spec.rh[0],spec.rh[1]);
    var r={ x:ri(1,GW-rw-1), y:ri(1,GH-rh-1), w:rw, h:rh };
    if(overlaps(r)) continue;
    r.cx=Math.floor(r.x+r.w/2); r.cy=Math.floor(r.y+r.h/2); r.id=rooms.length;
    rooms.push(r);
  }
  rooms.forEach(function(r){ for(var yy=r.y;yy<r.y+r.h;yy++) for(var xx=r.x;xx<r.x+r.w;xx++) floor[yy][xx]=1; });

  /* ---- corridors (Prim MST + a couple loops) ---- */
  var corridor = {}, connectedPairs = {};
  function pkey(i,j){ return Math.min(i,j)+'-'+Math.max(i,j); }
  function carveH(x0,x1,yy){ var s=Math.min(x0,x1),e=Math.max(x0,x1); for(var x=s;x<=e;x++){ if(floor[yy][x]===0){ floor[yy][x]=1; corridor[ck(x,yy)]=true; } } }
  function carveV(y0,y1,xx){ var s=Math.min(y0,y1),e=Math.max(y0,y1); for(var y=s;y<=e;y++){ if(floor[y][xx]===0){ floor[y][xx]=1; corridor[ck(xx,y)]=true; } } }
  function connect(a,b){
    if(chance(0.5)){ carveH(a.cx,b.cx,a.cy); carveV(a.cy,b.cy,b.cx); }
    else          { carveV(a.cy,b.cy,a.cx); carveH(a.cx,b.cx,b.cy); }
    connectedPairs[pkey(a.id,b.id)] = true;
  }
  function dist(a,b){ var dx=a.cx-b.cx, dy=a.cy-b.cy; return Math.sqrt(dx*dx+dy*dy); }
  if(rooms.length>1){
    var inT=[0], out=[];
    for(var i=1;i<rooms.length;i++) out.push(i);
    while(out.length){
      var best=null;
      for(var a=0;a<inT.length;a++) for(var b=0;b<out.length;b++){
        var d=dist(rooms[inT[a]],rooms[out[b]]);
        if(!best||d<best.d) best={d:d,from:inT[a],to:out[b],bi:b};
      }
      connect(rooms[best.from],rooms[best.to]);
      inT.push(best.to); out.splice(best.bi,1);
    }
    var extra=ri(1,2);
    for(var e=0;e<extra;e++){ var pa=rint(rooms.length),pb=rint(rooms.length); if(pa!==pb) connect(rooms[pa],rooms[pb]); }
  }

  /* ---- markers ---- */
  var markers = [], usedCells = {};
  function mcount(t){ return markers.filter(function(m){ return m.type===t; }).length; }
  function freeCell(r){
    var cells=[];
    for(var yy=r.y;yy<r.y+r.h;yy++) for(var xx=r.x;xx<r.x+r.w;xx++){ if(!usedCells[ck(xx,yy)]) cells.push({x:xx,y:yy}); }
    var c = cells.length ? pick(cells) : {x:r.cx,y:r.cy};
    usedCells[ck(c.x,c.y)]=true; return c;
  }
  function placeIn(r,type){ var c=freeCell(r); markers.push({type:type,x:c.x,y:c.y,room:r.id}); }

  function edgeDist(r){ return Math.min(r.cx, GW-1-r.cx, r.cy, GH-1-r.cy); }
  if(mode!=='empty'){
  var entranceRoom = rooms.slice().sort(function(a,b){ return edgeDist(a)-edgeDist(b); })[0];
  function carveToEdge(r){
    var dl=r.cx, dr=GW-1-r.cx, dt=r.cy, db=GH-1-r.cy, m=Math.min(dl,dr,dt,db);
    if(m===dt){ carveV(0,r.cy,r.cx); return {x:r.cx,y:0,dir:'down'}; }
    if(m===db){ carveV(r.cy,GH-1,r.cx); return {x:r.cx,y:GH-1,dir:'up'}; }
    if(m===dl){ carveH(0,r.cx,r.cy); return {x:0,y:r.cy,dir:'right'}; }
    carveH(r.cx,GW-1,r.cy); return {x:GW-1,y:r.cy,dir:'left'};
  }
  var entryCell = carveToEdge(entranceRoom);
  markers.push({type:'entrance', x:entryCell.x, y:entryCell.y, dir:entryCell.dir});

  var bossRoom = rooms.slice().sort(function(a,b){ return dist(b,entranceRoom)-dist(a,entranceRoom); })[0];
  if(bossRoom===entranceRoom && rooms.length>1) bossRoom=rooms[1];
  placeIn(bossRoom,'boss');
  if(chance(0.85)) placeIn(bossRoom,'treasure');
  var exitCell = carveToEdge(bossRoom);
  markers.push({type:'exit', x:exitCell.x, y:exitCell.y, dir:exitCell.dir});

  var others = rooms.filter(function(r){ return r!==entranceRoom && r!==bossRoom; });
  others.forEach(function(r){
    if(chance(0.62)) placeIn(r,'monster');
    if(chance(0.30)) placeIn(r,'treasure');
  });
  function count(t){ return markers.filter(function(m){return m.type===t;}).length; }
  shuffle(others.slice());
  var oi=0;
  while(count('monster')<2 && oi<others.length){ placeIn(others[oi++],'monster'); }
  if(count('treasure')<1 && others.length) placeIn(others[0],'treasure');

  var corrArr = Object.keys(corridor).map(function(k){ k=+k; return {x:k%GW,y:Math.floor(k/GW)}; });
  shuffle(corrArr).slice(0, ri(2,4)).forEach(function(c){ markers.push({type:'trap',x:c.x,y:c.y}); });
  }

  /* ---- secrets (DM-only; ~1/3 of dungeons have any) ----
     A secret passage is a STRAIGHT tunnel bored through solid rock
     (only empty, non-corridor cells) between two rooms — so it never
     lies on a visible route. A secret room is reachable ONLY this way. */
  var secretPaths = [], secretRooms = [];
  var secretFloor = []; for(var sfy=0;sfy<GH;sfy++) secretFloor.push(new Array(GW).fill(0));

  /* Find a clear, straight 1-wide tunnel through ROCK between rects A and B.
     Returns {cells, len, line:{x1,y1,x2,y2}} (cell coords) or null. */
  function straightTunnel(A,B){
    var opts=[];
    // horizontal — their row ranges overlap, rock columns lie between them
    var oy0=Math.max(A.y,B.y), oy1=Math.min(A.y+A.h,B.y+B.h)-1;
    if(oy0<=oy1){
      var L=A.x<B.x?A:B, R=A.x<B.x?B:A, lx=L.x+L.w, rx=R.x-1;
      if(lx<=rx){
        var rows=[]; for(var y=oy0;y<=oy1;y++) rows.push(y);
        var mh=(oy0+oy1)/2; rows.sort(function(a,b){ return Math.abs(a-mh)-Math.abs(b-mh); });
        for(var a=0;a<rows.length;a++){
          var yy=rows[a], ok=true;
          for(var x=lx;x<=rx;x++){ if(floor[yy][x]===1){ ok=false; break; } }
          if(ok){ var cells=[]; for(var x2=lx;x2<=rx;x2++) cells.push({x:x2,y:yy});
            opts.push({cells:cells, len:cells.length, line:{x1:L.x+L.w-1,y1:yy,x2:R.x,y2:yy}}); break; }
        }
      }
    }
    // vertical — their column ranges overlap, rock rows lie between them
    var ox0=Math.max(A.x,B.x), ox1=Math.min(A.x+A.w,B.x+B.w)-1;
    if(ox0<=ox1){
      var T=A.y<B.y?A:B, D=A.y<B.y?B:A, ty=T.y+T.h, by=D.y-1;
      if(ty<=by){
        var cols=[]; for(var x=ox0;x<=ox1;x++) cols.push(x);
        var mv=(ox0+ox1)/2; cols.sort(function(a,b){ return Math.abs(a-mv)-Math.abs(b-mv); });
        for(var c=0;c<cols.length;c++){
          var xx=cols[c], ok2=true;
          for(var y2=ty;y2<=by;y2++){ if(floor[y2][xx]===1){ ok2=false; break; } }
          if(ok2){ var cells2=[]; for(var y3=ty;y3<=by;y3++) cells2.push({x:xx,y:y3});
            opts.push({cells:cells2, len:cells2.length, line:{x1:xx,y1:T.y+T.h-1,x2:xx,y2:D.y}}); break; }
        }
      }
    }
    if(!opts.length) return null;
    opts.sort(function(a,b){ return a.len-b.len; });
    return opts[0];
  }

  function commitTunnel(tun){
    tun.cells.forEach(function(c){ secretFloor[c.y][c.x]=1; });
    secretPaths.push({ x1:tun.line.x1, y1:tun.line.y1, x2:tun.line.x2, y2:tun.line.y2 });
    var mid=tun.cells[Math.floor((tun.cells.length-1)/2)] || {x:tun.line.x1,y:tun.line.y1};
    markers.push({ type:'secret', x:mid.x, y:mid.y });
  }

  /* hidden shortcut: link two UNCONNECTED rooms with a clear rock tunnel */
  function addSecretShortcut(){
    if(rooms.length<3) return false;
    var cands=[];
    for(var i=0;i<rooms.length;i++) for(var j=i+1;j<rooms.length;j++){
      if(connectedPairs[pkey(rooms[i].id,rooms[j].id)]) continue;
      var t=straightTunnel(rooms[i],rooms[j]);
      if(t) cands.push(t);
    }
    if(!cands.length) return false;
    cands.sort(function(a,b){ return a.len-b.len; });
    commitTunnel(cands[rint(Math.min(3,cands.length))]);
    return true;
  }

  function rectFree(r){
    if(r.x<1||r.y<1||r.x+r.w>GW-1||r.y+r.h>GH-1) return false;
    var all=rooms.concat(secretRooms);
    for(var i=0;i<all.length;i++){ var o=all[i];
      if(r.x-1<o.x+o.w && r.x+r.w+1>o.x && r.y-1<o.y+o.h && r.y+r.h+1>o.y) return false; }
    for(var yy=r.y;yy<r.y+r.h;yy++) for(var xx=r.x;xx<r.x+r.w;xx++){ if(floor[yy][xx]===1) return false; }
    return true;
  }

  /* a secret room in solid rock, reached ONLY by a clear straight tunnel */
  function addSecretRoom(){
    for(var t=0;t<300;t++){
      var rw=ri(2,4), rh=ri(2,4);
      var r={ x:ri(1,GW-rw-1), y:ri(1,GH-rh-1), w:rw, h:rh };
      if(!rectFree(r)) continue;
      r.cx=Math.floor(r.x+r.w/2); r.cy=Math.floor(r.y+r.h/2);
      var order=rooms.slice().sort(function(a,b){ return dist(a,r)-dist(b,r); });
      var tun=null;
      for(var k=0;k<order.length;k++){ tun=straightTunnel(r,order[k]); if(tun) break; }
      if(!tun) continue;
      for(var yy=r.y;yy<r.y+r.h;yy++) for(var xx=r.x;xx<r.x+r.w;xx++) secretFloor[yy][xx]=1;
      secretRooms.push({ x:r.x, y:r.y, w:r.w, h:r.h, cx:r.cx, cy:r.cy });
      commitTunnel(tun);
      // a secret room always hides a hoard; ~half the time something guards it
      markers.push({ type:'treasure', x:r.cx, y:r.cy });
      if(chance(0.5)){
        var guard = chance(1/3) ? 'boss' : 'monster';   // 1/3 an EXTRA boss, else a normal monster
        var gx = (r.x===r.cx) ? r.x+r.w-1 : r.x;          // a cell apart from the hoard
        var gy = (r.y===r.cy) ? r.y+r.h-1 : r.y;
        markers.push({ type:guard, x:gx, y:gy });
      }
      return true;
    }
    return false;
  }

  /* number of secret features scales with complexity (occasional at low levels) */
  if(mode!=='empty'){
  var secretTries;
  if(L<=2){ secretTries = chance(0.4) ? 1 : 0; }
  else { secretTries = 1 + rint(spec.secretMax); }
  for(var st=0; st<secretTries; st++){
    if(chance(0.55)){ if(!addSecretRoom()) addSecretShortcut(); }
    else            { if(!addSecretShortcut()) addSecretRoom(); }
  }
  }

  var ctx = (RPGGen) ? RPGGen.context(rng) : null;
  function capf(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
  function diffPick(){ var x=rng(); return x<0.30?'Easy':(x<0.80?'Medium':'Hard'); }  // 30% easy / 50% medium / 20% hard
  function moneyStr(genre){
    if(genre==='fantasy'){
      var p=[];
      if(chance(0.45)) p.push(ri(1,9)+' gold');
      if(chance(0.6))  p.push(ri(1,15)+' silver');
      if(chance(0.7))  p.push(ri(2,30)+' copper');
      if(!p.length)    p.push(ri(2,30)+' copper');
      return 'Coins: '+p.join(', ');
    }
    if(genre==='sci-fi') return 'Credits (money): '+ri(10,500);
    return 'Money: '+ri(5,200);
  }

  /* 'detailed' mode: name & classify every foe, hoard and trap from the random lists */
  if(mode==='detailed' && ctx){
    var RM=(RPG&&RPG.monsters)||{};
    var mons=((RM[ctx.genre]||[]).concat(RM.generic||[])).filter(function(m){ return !m.a; }); // bosses are never animals
    var bossEpithets=['Dread','Elder','Ancient','Fell','Dire','Great','Black','Cursed'];
    var seqN=0;
    markers.forEach(function(m){
      if(m.type==='monster'){
        m.label=RPGGen.randomMonster(rng,ctx)||'Monster';
        m.note='('+diffPick().toLowerCase()+')';
        if(chance(0.30)){ var md=chance(0.5)?RPGGen.toneAdj(rng,ctx,'monster'):RPGGen.toneDesc(rng,ctx,'monster'); if(md) m.note+=' '+capf(md)+'.'; }
        m.seq=seqN++;
      } else if(m.type==='boss'){
        var bnm=RPGGen.randomName(rng,ctx);
        var cobj=pick(mons); var creature=(cobj&&(cobj.n||cobj))||'Beast';
        var named=bnm && chance(0.5);
        m.label=named ? bnm : creature;   // a named villain OR a creature, never "Name the Creature"
        m.note='(boss)';
        var bcat=named?'person':'monster';
        if(chance(0.45)){ var bd=chance(0.5)?RPGGen.toneAdj(rng,ctx,bcat):RPGGen.toneDesc(rng,ctx,bcat); if(bd) m.note+=' '+capf(bd)+'.'; }
        m.seq=seqN++;
      } else if(m.type==='treasure'){
        m.label='Treasure';
        var parts=[ RPGGen.randomItem(rng,ctx)||'a trinket' ];
        if(chance(0.55)) parts.push(RPGGen.randomItem(rng,ctx));
        if(chance(0.6)) parts.push(moneyStr(ctx.genre));
        m.note=parts.filter(Boolean).join(', ')+'.';
        m.seq=seqN++;
      } else if(m.type==='trap'){
        m.label=RPGGen.randomTrap(rng,ctx)||'Trap';
        m.note='';
        m.seq=seqN++;
      }
    });
  }

  /* ---- name & flavor, drawn from the random lists + chosen tone ---- */
  var P1=['The Sunken','The Forgotten','The Shattered','The Black','The Hollow','The Buried'];
  var P2=['Vaults','Catacombs','Warrens','Crypts','Halls','Tombs'];
  var dName=null, dFlavor=null;
  if(ctx){
    var loc=RPGGen.randomLocation(rng,ctx);
    if(loc) dName=(/^the\b/i.test(loc)?'':'The ')+loc;
    var fcat=pick(['place','sound','building']);
    var fd=RPGGen.toneDesc(rng,ctx,fcat)||RPGGen.toneDesc(rng,ctx,'place');
    if(fd) dFlavor=capf(fd)+'.';
  }

  return {
    version: 1,
    seed: seed,
    level: L,
    name: dName || (pick(P1)+' '+pick(P2)),
    depth: ['I','II','III','IV','V'][ri(0,4)],
    flavor: dFlavor || 'Beyond the torchlight, the map runs dark.',
    genre: (mode==='detailed' && ctx) ? ctx.genre : null,
    tone: (mode==='detailed' && ctx) ? ctx.tone : null,
    grid: { gw:GW, gh:GH, cell:CELL },
    rooms: rooms.map(function(r){ return {x:r.x,y:r.y,w:r.w,h:r.h,id:r.id}; }),
    floor: floor,
    markers: markers,
    secretPaths: secretPaths,
    secretRooms: secretRooms,
    secretFloor: (secretPaths.length||secretRooms.length) ? secretFloor : null,
    tally: {
      rooms: rooms.length,
      foes: mcount('monster') + mcount('boss'),
      traps: mcount('trap'),
      loot: mcount('treasure'),
      secret: secretPaths.length
    }
  };
}
