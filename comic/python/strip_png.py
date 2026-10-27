"""Write a single arbitrary-height PNG without allocating the whole episode in RAM.
Only render slices are decoded; slice boundaries never become pages in the document.
"""
import hashlib, json, os, struct, sys, zlib
from PIL import Image
sys.stdin.reconfigure(encoding="utf-8");sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
def write_strip(spec):
    width,height=spec["width"],spec["height"];parts=spec["parts"]
    if not isinstance(width,int) or not 1<=width<=4096 or not isinstance(height,int) or not 1<=height<=2000000:
        raise ValueError("长图尺寸超出支持范围")
    if sum(p["height"] for p in parts)!=height: raise ValueError("分段总高度不一致")
    output=spec["output"];temporary=output+".tmp"
    def chunk(f,kind,data):
        f.write(struct.pack(">I",len(data)));f.write(kind);f.write(data)
        f.write(struct.pack(">I",zlib.crc32(kind+data)&0xffffffff))
    y=0;compressor=zlib.compressobj(6);pending=bytearray()
    try:
        with open(temporary,"wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")
            chunk(f,b"IHDR",struct.pack(">IIBBBBB",width,height,8,2,0,0,0))
            for part in parts:
                if part["y"]!=y: raise ValueError("分段顺序不连续")
                with Image.open(part["path"]) as source:
                    if source.size!=(width,part["height"]) or source.format!="PNG": raise ValueError("分段图片尺寸不一致")
                    rgba=source.convert("RGBA")
                    base=Image.new("RGB",rgba.size,"white");base.paste(rgba,mask=rgba.getchannel("A"))
                    for row in range(base.height):
                        pending.extend(compressor.compress(b"\x00"+base.crop((0,row,width,row+1)).tobytes()))
                        if len(pending)>=65536:
                            chunk(f,b"IDAT",bytes(pending));pending.clear()
                    y+=base.height
                    base.close();rgba.close()
            pending.extend(compressor.flush())
            if pending: chunk(f,b"IDAT",bytes(pending))
            chunk(f,b"IEND",b"")
        os.replace(temporary,output)
    finally:
        if os.path.exists(temporary): os.remove(temporary)
    sha=hashlib.sha256()
    with open(output,"rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): sha.update(block)
    return {"width":width,"height":height,"partsRendered":len(parts),"files":1,"bytes":os.path.getsize(output),"sha256":sha.hexdigest()}
if __name__=="__main__":
    try: json.dump(write_strip(json.load(sys.stdin)),sys.stdout)
    except Exception as e:
        print(str(e),file=sys.stderr);sys.exit(1)
