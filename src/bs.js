function MakeArray(size) {
  for (let i = 1; i <= size; i++) {
    this.length = size
    this[i] = 0
  }
}

function N(X) {
  let A1 = 0.31938153,
    A2 = -0.356563782,
    A3 = 1.781477937,
    A4 = -1.821255978,
    A5 = 1.330274429,
    L,
    K,
    W

  L = Math.abs(X)
  K = 1.0 / (1.0 + 0.2316419 * L)
  W =
    1.0 -
    (1.0 / 2.5066282746310002) *
      Math.exp((-L * L) / 2.0) *
      (A1 * K + A2 * K * K + A3 * K * K * K + A4 * K * K * K * K + A5 * K * K * K * K * K)

  if (X < 0) {
    return 1.0 - W
  } else {
    return W
  }
}

// finds derivative of cumulative normal distr N(x)

function DN(x) {
  return Math.exp((-x * x) / 2) / Math.pow(2 * 3.14159, 1 / 2)
}

// Calculates Black-Scholes  price of Eur put

function BSput(S, X, sigma, q, r, Tdays) {
  let p, d1, d2, T
  T = Tdays / 365 // Time in years
  d1 = (Math.log(S / X) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  d2 = (Math.log(S / X) + (r - q - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  p = Math.exp(-r * T) * X * N(-d2) - Math.exp(-q * T) * S * N(-d1)
  return p
}

// Calculates Black-Scholes  price of Eur Call

function BScall(S, X, sigma, q, r, Tdays) {
  let c, d1, d2, T
  T = Tdays / 365 // Time in years
  d1 = (Math.log(S / X) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  d2 = (Math.log(S / X) + (r - q - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  c = Math.exp(-q * T) * S * N(d1) - Math.exp(-r * T) * X * N(d2)
  return c
}

function BSdeltaCall(S, X, sigma, q, r, Tdays) {
  let T = Tdays / 365 // Time in years
  let d1 = (Math.log(S / X) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  return Math.exp(-r * T) * N(d1)
}

function BSdeltaPut(S, X, sigma, q, r, Tdays) {
  let T = Tdays / 365 // Time in years
  let d1 = (Math.log(S / X) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  return Math.exp(-r * T) * (N(d1) - 1)
}

// Calculates the derivative with respect to // sigma of the Black-Scholes  price of Eur Call

function BScallderivative(S, X, sigma, q, r, Tdays) {
  let T = Tdays / 365 // Time in years
  let d1 = (Math.log(S / X) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  let d2 = (Math.log(S / X) + (r - q - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  let dd1 =
    (T * ((sigma * sigma) / 2 - r - q) - Math.log(S / X)) /
    (sigma * sigma * Math.pow(T, 1 / 2))
  let dd2 = dd1 - Math.pow(T, 1 / 2)
  let dc = Math.exp(-q * T) * S * DN(d1) * dd1 - Math.exp(-r * T) * X * DN(d2) * dd2
  return dc
}

export function callIV(S, X, guess, q, r, Tdays, c) {
  // Calculates the volatility from an initial guess when all
  // other parameters are known (including the price c)
  let approx = guess
  for (
    let i = 1;
    i <= 10;
    i++ // implementing Newton's method
  ) {
    approx =
      approx -
      (BScall(S, X, approx, q, r, Tdays) - c) /
        BScallderivative(S, X, approx, q, r, Tdays)
  }
  return approx
}

// pUsd = BSPrice(opt.type, rate, strike, exdays, iv, ir);
// pUsd = BSPrice('call', 6460, 7500, 14, 72);

export function price(Type, S, X, T, V, IR) {
  let r = 0.0
  if (typeof IR === 'number') {
    r = IR
  }
  if (Type == 'call') {
    return BScall(S, X, V / 100.0, 0.0, r, T)
  }
  return BSput(S, X, V / 100.0, 0.0, r, T)
}

export function delta(Type, S, X, T, V, IR) {
  let r = 0.0
  if (typeof IR === 'number') {
    r = IR
  }
  if (Type == 'call') {
    return BSdeltaCall(S, X, V, 0.0, r, T)
  } else {
    return BSdeltaPut(S, X, V, 0.0, r, T)
  }
}

export function IV(Type, S, X, T, c, IR) {
  let i,
    tol = 0.00001,
    err,
    sig = 0.5,
    sig_u = 5,
    sig_d = 0.0001,
    r = 0.0
  if (typeof IR === 'number') {
    r = IR
  }
  if (Type == 'call') {
    i = 0
    err = BScall(S, X, sig, 0, r, T) - c
    while (i < 32 && Math.abs(err) > tol) {
      if (err < 0) {
        sig_d = sig
        sig = (sig_u + sig) / 2.0
      } else if (err > 0) {
        sig_u = sig
        sig = (sig_d + sig) / 2.0
      } else {
        return sig
      }
      err = BScall(S, X, sig, 0, r, T) - c
      i = i + 1
    }
    return sig
  } else {
    i = 0
    err = BSput(S, X, sig, 0, r, T) - c
    while (i < 32 && Math.abs(err) > tol) {
      if (err < 0) {
        sig_d = sig
        sig = (sig_u + sig) / 2.0
      } else {
        sig_u = sig
        sig = (sig_d + sig) / 2.0
      }
      err = BSput(S, X, sig, 0, r, T) - c
      i = i + 1
    }
    return sig
  }
}

export function put(S, X, sigma, Q, r, Tdays, Nofnodes) {
  //Calculation of Eur Put using BINOMIAL TREE
  let T, dt, a, b2, u, d, p, q //q=1-p the rest see in Hull p.337
  //do not confuse q with dividents Q
  let Q0 = new MakeArray(Nofnodes)
  let Q1 = new MakeArray(Nofnodes) //European Put Prices
  // In array Q0[*]
  //and in Q1[*] european option prices
  // at a fixed moment Q0[0] is the lowest stock price
  //i.e. P is a vertical section of the tree (tree isgrowing from
  //left to right see picture in Hull
  T = Tdays / 365 // Time in years
  dt = T / (Nofnodes - 1) //Number of time intervals is Nofnodes -1
  a = Math.exp((r - Q) * dt)
  b2 = a * a * (Math.exp(sigma * sigma * dt) - 1) //b2=b^2
  u =
    (a * a + b2 + 1 + Math.sqrt((a * a + b2 + 1) * (a * a + b2 + 1) - 4 * a * a)) /
    (2 * a)
  //u=exp(sigma*dt); OLD CoxRossRubinstein where prob can be
  //negative
  d = 1 / u
  p = (a - d) / (u - d)
  q = 1 - p
  if (q > 0 && p > 0) {
    //positive probabilities, calculate the prices
    //calculation of terminal prices and values of the option
    //at time i*dt prices are S*u^j*d^(i-j)  j=0,1,...i
    let i = Nofnodes
    Q0[0] = S * Math.pow(d, i - 1)
    if (Q0[0] <= X) Q1[0] = X - Q0[0]
    else Q1[0] = 0
    for (let j = 1; j <= i - 1; ++j) {
      Q0[j] = Q0[j - 1] * (u / d)
      if (Q0[j] <= X) Q1[j] = X - Q0[j]
      else Q1[j] = 0
    }
    //End of calculation terminal prices of Am Option
    // Calculation of dt-period  discount rate
    let daydiscount = Math.exp(-r * dt)
    //going backwards through the tree
    //Calculating Eur Put
    for (
      let k = Nofnodes;
      k >= 1;
      --k //changing time
    ) {
      for (
        let l = 0;
        l < k - 1;
        ++l //changing entries for stock prices //and opt prices using nodes from the previous t
      ) {
        Q0[l] = Q0[l] * u //put new stock price
        Q1[l] = (q * Q1[l] + p * Q1[l + 1]) * daydiscount
        //no check for early exercize
      }
    }
    return Q1[0]
  } // end if positive probabilities //negative probabilities Do Not Exist in Our Approximation This is
  //from old times
  else {
    throw new Error('Negative probabilities, Increase Volatility')
  }
} //end EurPut

export function call(S, X, sigma, Q, r, Tdays, Nofnodes) {
  //Calculation of Eur Call using BINOMIAL TREE
  let T, dt, a, b2, u, d, p, q //q=1-p the rest see in Hull p.337
  //do not confuse q with dividents Q
  let Q0 = new MakeArray(Nofnodes)
  let Q1 = new MakeArray(Nofnodes) //European Call Prices
  // In array Q0[*]
  //and in Q1[*] european option prices
  // at a fixed moment Q0[0] is the lowest stock price
  //i.e. P is a vertical section of the tree (tree isgrowing from
  //left to right see picture in Hull
  T = Tdays / 365 // Time in years
  dt = T / (Nofnodes - 1) //Number of time intervals is Nofnodes -1
  a = Math.exp((r - Q) * dt)
  b2 = a * a * (Math.exp(sigma * sigma * dt) - 1) //b2=b^2
  u =
    (a * a + b2 + 1 + Math.sqrt((a * a + b2 + 1) * (a * a + b2 + 1) - 4 * a * a)) /
    (2 * a)
  //u=exp(sigma*dt); OLD CoxRossRubinstein where prob can be
  //negative
  d = 1 / u
  p = (a - d) / (u - d)
  q = 1 - p
  if (q > 0 && p > 0) {
    //positive probabilities, calculate the prices
    //calculation of terminal prices and values of the option
    //at time i*dt prices are S*u^j*d^(i-j)  j=0,1,...i
    let i = Nofnodes
    Q0[0] = S * Math.pow(d, i - 1)
    if (Q0[0] >= X)
      //here is the  change from call to put
      Q1[0] = Q0[0] - X
    //here is the  change from call to put
    else Q1[0] = 0
    for (let j = 1; j <= i - 1; ++j) {
      Q0[j] = Q0[j - 1] * (u / d)
      if (Q0[j] >= X)
        //here is the  change from call to put
        Q1[j] = Q0[j] - X
      //here is the  change from call to put
      else Q1[j] = 0
    }
    //End of calculation terminal prices of Eur
    // Calculation of dt-period  discount rate
    let daydiscount = Math.exp(-r * dt)
    //going backwards through the tree
    //Calculating Eur Put
    for (
      let k = Nofnodes;
      k >= 1;
      --k //changing time
    ) {
      for (
        let l = 0;
        l < k - 1;
        ++l //changing entries for stock prices //and opt prices using nodes from the previous t
      ) {
        Q0[l] = Q0[l] * u //put new stock price
        Q1[l] = (q * Q1[l] + p * Q1[l + 1]) * daydiscount
        //no check for early exercize
      }
    }
    return Q1[0]
  } // end if positive probabilities //negative probabilities Do Not Exist in Our Approximation This is
  //from old times
  else {
    throw new Error('Negative probabilities, Increase Volatility')
  }
}
