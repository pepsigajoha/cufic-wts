// Read-only mathematical audit. No DB calls or generated-price changes.
// Run: node scripts/verify-price-math.mjs
import assert from 'node:assert/strict'
import { MarketSim, PRNG, defaultMacro, defaultWeights, getKRXRoundPrice, buildCorrelationMatrix, choleskyDecompose, simulateNextRound } from '../src/admin/priceSim.js'

const zeroWeights = () => Object.fromEntries(['shock','gravity'].map(k => [k, Object.fromEntries(Object.keys(defaultMacro()).map(k=>[k,0]))]))
const params = (overrides = {}) => ({ baseMu: 0, weights: zeroWeights(), garch: {omega:0.04/252,alpha:0,beta:0}, thresholds:{unemp:5,inf:8}, jump:{lambda:0,mu:0,sigma:0}, ...overrides })
const sim = () => new MarketSim({seed:42,startPrice:1_000_000,nCompanies:1,compMultiplierRange:[1,1]})
const report = { passes:[], findings:{} }
const pass = name => report.passes.push(name)

// Independent closed-form one-step GBM + multiple-jump reference.
{
  const s = sim(), mu=.05, sigma=.2, lambda=2, jm=-.05, js=.1
  const normals=[.75,-.2]
  s.prng.normal=()=>normals.shift()
  s.prng.poisson=x=>{assert.equal(x,lambda/252);return 2}
  const expected=getKRXRoundPrice(1_000_000*Math.exp((mu-.5*sigma*sigma-lambda*Math.expm1(jm+.5*js*js))/252+sigma*.75/Math.sqrt(252)+2*jm+js*Math.sqrt(2)*(-.2)))
  assert.equal(s.step(defaultMacro(),params({baseMu:mu,jump:{lambda,mu:jm,sigma:js}}))[0],expected)
  pass('GBM dt/sqrt(dt), Ito correction, Merton compensation and multi-jump aggregation match independent formula')
}
{
  const a=buildCorrelationMatrix(4,.4), l=choleskyDecompose(a)
  for(let i=0;i<4;i++) for(let j=0;j<4;j++) assert.ok(Math.abs(l[i].reduce((s,x,k)=>s+x*l[j][k],0)-a[i][j])<1e-12)
  pass('Cholesky L*L^T matches valid equicorrelation matrix')
}
{
  const r = new PRNG(781), n=100000
  let sum=0,sq=0,po=0,posq=0
  for(let i=0;i<n;i++){const z=r.normal();sum+=z;sq+=z*z;const k=r.poisson(.4);po+=k;posq+=k*k}
  const mean=sum/n, variance=sq/n-mean*mean, pm=po/n,pv=posq/n-pm*pm
  assert.ok(Math.abs(mean)<.02 && Math.abs(variance-1)<.03)
  assert.ok(Math.abs(pm-.4)<.01 && Math.abs(pv-.4)<.02)
  report.randomSample={n,normalMean:mean,normalVariance:variance,poissonMean:pm,poissonVariance:pv}
  pass('Fixed-seed normal and Poisson sample moments within tolerance (sanity check, not proof)')
}
{
  const s=sim();s.currentVar=[.0002];s.prevRet=[.01]
  s.prng.normal=()=>0;s.prng.poisson=()=>0
  s.step(defaultMacro(),params({garch:{omega:.00001,alpha:.1,beta:.85}}))
  assert.ok(Math.abs(s.currentVar[0]-.00019)<1e-15)
  pass('GARCH recurrence arithmetic matches omega + alpha*r^2 + beta*h')
}
// Actual behavior of crisis volatility cap using a high pre-crisis variance.
{
  const run=unemp=>{const s=sim();s.prng.normal=()=>1;s.prng.poisson=()=>0;return s.step({...defaultMacro(),unemp},params({garch:{omega:1.5**2/252,alpha:0,beta:0}}))[0]}
  report.findings.crisisCap={normalSigma:1.5,crisisSigma:Math.min(1.5*1.3,1.2),normalPrice:run(3),crisisPrice:run(6),effectiveVariancePersistence:.85+.1*1.3**2}
  assert.ok(report.findings.crisisCap.crisisSigma<report.findings.crisisCap.normalSigma)
}
// News shock is put in annual drift, then divided by 252, and disappears next day.
{
  const s=sim();s.prng.normal=()=>0;s.prng.poisson=()=>0
  const w=zeroWeights();w.shock.int_r=-.2
  const p=params({weights:w,garch:{omega:0,alpha:0,beta:0}})
  const changed={...defaultMacro(),int_r:3}
  const first=s.step(changed,p)[0], second=s.step(changed,p)[0]
  assert.equal(first,second)
  report.findings.oneDayMacroShock={annualDriftChange:-.2,oneDayLogReturn:-.2/252,theoreticalPercent:100*Math.expm1(-.2/252),actualFirstPrice:first,actualSecondPrice:second}
}
// A deterministic return has zero innovation; current code feeds its raw return back into GARCH.
{
  const s=sim();s.prng.normal=()=>0;s.prng.poisson=()=>0
  const p=params({baseMu:.5,garch:{omega:0,alpha:.1,beta:.85}})
  s.step(defaultMacro(),p)
  const prevReturn=s.prevRet[0]
  s.step(defaultMacro(),p)
  assert.ok(s.currentVar[0]>0)
  report.findings.rawReturnAsInnovation={prevReturn,varianceAfterDeterministicMove:s.currentVar[0],standardZeroInnovationVariance:0}
}
{
  const s=new MarketSim({seed:1,startPrice:10000,nCompanies:1,compMultiplierRange:[1,1]})
  s.prng.normal=()=>0;s.prng.poisson=()=>0
  for(let i=0;i<252;i++)s.step(defaultMacro(),params({baseMu:.05,garch:{omega:0,alpha:0,beta:0}}))
  report.findings.dailyRounding={actual:s.price[0],continuousGBM:10000*Math.exp(.05)}
  assert.equal(s.price[0],10000)
}
{
  const p=simulateNextRound({stockIds:['HALTED'],currentPrices:{HALTED:0},seed:42})
  report.findings.zeroPriceRevival=p.HALTED
  assert.ok(p.HALTED>0)
}
{
  const a=buildCorrelationMatrix(3,-.9),l=choleskyDecompose(a)
  report.findings.invalidCorrelation={rho:-.9,n:3,minimumValidRho:-.5,reconstructedDiagonal:l.map(row=>row.reduce((s,x)=>s+x*x,0))}
}
// Reachability under the engine's default GARCH and jump parameters in a crisis.
{
  let capDays=0, pathsWithCap=0, maxUncappedSigma=0
  for(let seed=0;seed<200;seed++) {
    const s=new MarketSim({seed,nCompanies:1,startPrice:10000})
    let touched=false
    for(let day=0;day<252;day++) {
      s.step({...defaultMacro(),unemp:6},params({garch:{omega:.00001,alpha:.1,beta:.85},jump:{lambda:2,mu:-.05,sigma:.1}}))
      const sigma=Math.sqrt(s.currentVar[0]*252)
      maxUncappedSigma=Math.max(maxUncappedSigma,sigma)
      if(sigma>1.2){capDays++;touched=true}
    }
    if(touched)pathsWithCap++
  }
  report.crisisDefaultExperiment={paths:200,daysPerPath:252,pathsWithSigmaAbove1_2:pathsWithCap,daysWithSigmaAbove1_2:capDays,maxUncappedSigma}
}
console.log(JSON.stringify(report,null,2))
