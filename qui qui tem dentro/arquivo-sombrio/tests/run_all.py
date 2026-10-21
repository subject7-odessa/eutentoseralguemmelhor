"""Roda todos os testes e mostra um resumo. Precisa de: pip install playwright && playwright install chromium"""
import subprocess,sys,os,glob,re
HERE=os.path.dirname(os.path.abspath(__file__))
tot=0;ruins=[]
for f in sorted(glob.glob(os.path.join(HERE,'test_*.py'))):
    nome=os.path.basename(f);r=subprocess.run([sys.executable,f],capture_output=True,text=True,timeout=300);out=r.stdout+r.stderr
    erros=re.findall(r"ERRS \[(.*?)\]\s*$",out,re.M);js=[e for e in erros if e.strip() and 'Failed to load resource' not in e]
    falhas=[l for l in out.splitlines() if l.startswith('FAIL')]
    ok=r.returncode==0 and not js and not falhas
    tot+=1;print(('OK    ' if ok else 'FALHOU'),nome)
    if not ok:ruins.append(nome);print('   ',(out[-600:] if out.strip() else 'sem saída').replace('\n','\n    '))
print('\n%d de %d testes passaram'%(tot-len(ruins),tot));sys.exit(1 if ruins else 0)
