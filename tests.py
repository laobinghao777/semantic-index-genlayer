import sys,types,json,unittest,importlib.util
from pathlib import Path
class E(Exception):pass
class Contract:
    def __new__(cls):
        x=super().__new__(cls);x.collections={};x.cases={};return x
sender=types.SimpleNamespace(as_hex='owner');answer={}
gl=types.ModuleType('genlayer');gl.contract=types.SimpleNamespace(Contract=Contract);gl.storage=types.SimpleNamespace(TreeMap=dict)
gl.message=types.SimpleNamespace(sender_address=sender);gl.vm=types.SimpleNamespace(UserError=E)
gl.public=types.SimpleNamespace(write=lambda f:f,view=lambda f:f)
gl.nondet=types.SimpleNamespace(exec_prompt=lambda *a,**k:answer)
gl.eq_principle=types.SimpleNamespace(prompt_comparative=lambda f,p:f())
gt=types.ModuleType('genlayer.types');gt.u256=int
sys.modules['genlayer']=gl;sys.modules['genlayer.types']=gt
def load(name,cls):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).parent/'contract.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return getattr(m,cls)
Index=load('semantic-index','SemanticIndex')
class Tests(unittest.TestCase):
    def setUp(self):sender.as_hex='owner'
    def index(self):
        c=Index();c.create_case('Incident registry','Same incident means the same city, calendar date and event type.');c.add_entry('1','Power outage in Paris on 2026-11-08.');return c
    def test_exact_idempotency(self):
        c=self.index();c.add_entry('1','Power outage in Paris on 2026-11-08.');self.assertEqual(json.loads(c.get_case('1'))['revision'],1)
    def test_alias_does_not_replace(self):
        global answer;answer={'relations':[{'relation':'same','reason':'Same date city and event'}]};c=self.index();c.add_entry('1','Paris electricity interruption dated 2026-11-08.');r=json.loads(c.get_case('1'));self.assertEqual(len(r['entries']),1);self.assertEqual(r['decisions'][-1]['canonical_id'],1)
    def test_unknown_not_inserted(self):
        global answer;answer={'relations':[{'relation':'unknown','reason':'Date absent'}]};c=self.index();c.add_entry('1','Paris suffered an electricity interruption.');r=json.loads(c.get_case('1'));self.assertEqual(len(r['entries']),1);self.assertEqual(r['decisions'][-1]['status'],'ambiguous')
    def test_missing_comparison(self):
        global answer;answer={'relations':[]};c=self.index()
        with self.assertRaises(E):c.add_entry('1','Different incident in another city.')
    def test_owner(self):
        c=self.index();sender.as_hex='other'
        with self.assertRaises(E):c.add_entry('1','Some unrelated incident description.')
if __name__=='__main__':unittest.main()
