const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs')
const csv = require('csv-parser')
const axios = require('axios')

//Global Vars
var Gdriver, GuserLogFileHandle
const Guserlogfilename = '/users/cfield/dev/pshipcof/userlog.txt'
const GpartnerQueryKey = process.env.NEW_RELIC_PARTNER_API_KEY
const GpartnerId = process.env.NEW_RELIC_PARTNER_ID
const GloginURL = 'https://login.newrelic.com'
const GfilterMasterAccountId = process.env.NEW_RELIC_PRODMASTER_ACCOUNT_ID
const GfilterSubAccountId    = ''
const GtestRunUserLimit = 5
const GtestRunAcctLimit = 5
const GupdateControlFlag = false

//
//
//
async function ScrapeBrowserUp() {
  Gdriver = await new Builder().forBrowser('chrome').build()
  await Gdriver.manage().setTimeouts( { implicit: 10000, pageLoad: 30000, script: 15000 } )
  console.log('ScrapeBrowserUp -> Gdriver is good')
  //await driver.get(firsturl)
  //await driver.manage().addCookie({name: logincookiename,value:logincookievalue, domain:'*.newrelic.com'})
}
//
//
//
async function ScrapeLoginManualCredentials(loginURL) {

  try {

    console.log('ScrapeLoginManualCredentials(): loading loginURL:',loginURL)
    await Gdriver.get(loginURL)
    await Gdriver.wait(until.titleIs('New Relic One'), 60000);
    console.log('ScrapeLoginManualCredentials()-> successfully found [New Relic One]')

  } catch (error) {
    console.log('ScrapeLoginManualCredentials() failed:', error)
    screenshot = await Gdriver.takeScreenshot()
    fs.writeFileSync('ScrapeSSOLogin.png',screenshot,'base64')
    throw error
  }
}

async function ScrapeSSOLogin(user,pw) {

  try {
    loginURL = 'https://login.newrelic.com'
    await Gdriver.get(loginURL)
    we = await Gdriver.findElement(By.id('login_email'))
    bise = await we.isEnabled()
    console.log('testing webelement',bise)
    await we.sendKeys(user)
    console.log('click pw click')
    await Gdriver.findElement(By.id('login_submit')).click()

    //transition to okta
    we = await Gdriver.findElement(By.id('okta-signin-username'))
    await we.sendKeys(user)
    Gdriver.sleep(1000)
    we = await Gdriver.findElement(By.id('okta-signin-password'))
    await we.sendKeys(pw)
    Gdriver.sleep(2000)

    //submit user/pw
    await Gdriver.findElement(By.id('okta-signin-submit')).click()
    Gdriver.sleep(1600)


    //send 2FA push
    await Gdriver.findElement(By.xpath('//form/div[2]/input[@value="Send Push"]')).click()

    console.log('ScrapeSSOLogin(): waiting on change to one.newrelic.com')
    await Gdriver.wait(until.titleIs('New Relic One'), 60000);

    console.log('login good')
  } catch (error) {
    console.log('ScrapeSSOLogin() failed:', error)
    throw error
  } finally {
    screenshot = await Gdriver.takeScreenshot()
    fs.writeFileSync('ScrapeSSOLogin.png',screenshot,'base64')
  }
}



async function ScrapeLoop(nAccountId, userlist, userlog, modelroles, bChange=false) {

  var oUser, bExists = true

  for (oUser of userlist) {

    oUser.accountId = nAccountId

    //only interested in usertype=user
    if(oUser.role != 'user'){
      oUser.change = 'skip'
      console.log('skipping user:',oUser)
      continue
    }
    if (UserLogTest(userlog,oUser)){
      oUser.change = 'pdone'
      console.log('skipping user:',oUser)
      continue
    }

    try {
      api_url = 'https://account.newrelic.com/accounts/' + oUser.accountId.toString() + '/users/' + oUser.id

      console.log(`${(new Date()).toISOString()}:ScrapeLoop()-> start:`,bChange, oUser.email)
      await Gdriver.get(api_url);


      weroles = await Gdriver.findElement(By.xpath('//div[@class="User-rolesList User-addOnRole"]/div/div[2]/div/div/div/div'))
      //console.log('found roles',weroles)

      //so clicks don't continually bump window
      //await Gdriver.executeScript("window.scrollTo(0, document.body.scrollHeight)")
      await Gdriver.executeScript("arguments[0].scrollIntoView();",weroles)

      //Gdriver.sleep(2000)

      werows = await weroles.findElements(By.xpath('.//label'))
      //console.log('werows length:',werows.length)

      oUser.addonroles = []
      bDiff = false
      ndcnt = 0
      for (werow of werows){
        weinput = await werow.findElement(By.xpath('.//div/input'))
        urole = await werow.getText()
        uenabled = await weinput.isSelected()
        if(modelroles.get(urole).enabled != uenabled){
          // debug print
          //console.log('ScrapeLogin()-> debug print change',urole,uenabled,modelroles.get(urole).enabled)
          await weinput.click()
          bDiff = true
          ndcnt++
          oUser.change = 'needs'
        }
        oUser.addonroles.push({role:urole,enabled:uenabled})
      } //for()
      console.log('ScrapeLoop()-> roles are different:',bDiff,ndcnt)

      if (!bDiff){ oUser.change = 'nodiff'}
      //Did the controller ask us to actually change anything
      if(bChange && bDiff){
        //save it - Button with span - "Update user"
        console.log('clicking Update user')
        we = await Gdriver.findElement(By.xpath('//div[@class="User-commandBar"]/div/button[2]/span[contains(.,"Update user")]'))
        await we.click()
        oUser.change = 'changed'
      }

      //whether we changed the user or it was already set; write out a log entry
      WriteUserLog(Guserlogfilename,oUser)

    //await driver.wait(until.titleIs('webdriver - Google Search'), 1000);
    } catch(error) {
      console.log('ScrapeLogin()-> caught error',error)
        Gdriver.takeScreenshot().then(function(data){
          fs.writeFileSync('ScrapeLoginError.png',data,'base64')
        })
    } //finally
  } //loop
}


function LoadControlFile(filename, cfa) {
  fs.createReadStream(filename)
    .pipe(csv())
    .on('data', (row) => {
      console.log('LCF() row:',row)
      cfa.push(row)
    })
    .on('end', () => {
      console.log('CSV file successfully processed', cfa)
    });
}

async function ScrapeBrowserDown(){
  await Gdriver.quit()
}

async function GetUserList(sPartnerId, sPartnerKey, sAccountId){
  //
  // By empirical discovery; it does not appear that the POA-User-API is paginated
  // so just get page=1
  //
  alist = await GetUserListPage(sPartnerId, sPartnerKey, sAccountId, i)
  console.log('GetUserList()-> count',alist.length)
  return alist
}
//
//
//
async function GetUserListPage(sPartnerId, sPartnerKey, sAccountId, nPage=1){
  sURI = 'https://rpm.newrelic.com/api/v2/partners/' + sPartnerId + '/accounts/'+ sAccountId + '/users?page=' + nPage.toString()

  var appsListOpts = {
  	headers: {'Accept': 'application/json', 'X-Api-Key': sPartnerKey}
  }

  console.log(`GetUserListPage(${nPage})-> loading axios.get:`, sURI)
  try {
    const response = await axios.get(sURI,appsListOpts)
    if(response.status != 200){
      console.log('GetUserList()-> failed:', response.status, response.data)
      return []
    }
    //debug statement
    //console.log('response.data:',response.data)
    userlist = response.data.users
    console.log(`GetUserListPage(${nPage})-> primary response count:`, userlist.length)
    return userlist

  } catch (error) {
    console.log('GetUserList()-> dang it:',error)
    return []
  }
}

async function GetAccountList(sPartnerId, sPartnerKey){

  alist = []
  i=1
  for (; i < 11;i++){
    plist = await GetAccountListPage(sPartnerId, sPartnerKey, i)
    alist = [...new Set([...alist,...plist])]
    if(plist.length < 1000){
      break
    }
  }
  console.log('GetAccountList()-> page,count',i,alist.length)
  return alist
}

async function GetAccountListPage(sPartnerId, sPartnerKey, nPage=1) {
  sURI = 'https://rpm.newrelic.com/api/v2/partners/' + sPartnerId + '/accounts?page=' + nPage.toString()

  var appsListOpts = {
  	headers: {'Accept': 'application/json', 'X-Api-Key': sPartnerKey}
  }

  console.log(`GetAccountListPage(pg=${nPage})-> axios.get():`,sURI)
  try {
    const response = await axios.get(sURI,appsListOpts)
    if(response.status != 200){
      console.log('GetAccountListPage()-> failed:', response.status, response.data)
      return []
    }

    //debug data dump
    //console.log('response.data:',response.data)
    accountlist = response.data.accounts.slice()
    console.log(`GetAccountListPage(pg=${nPage})-> primary response count:`,accountlist.length)
    return accountlist

  } catch (error) {
    console.log(`GetAccountListPage(pg=${nPage})-> dang it:`,error)
    return []
  }
}

function LoadModelRoles(){
  ModelRoles = new Map()
  ModelRoles.set('Alerts manager',{role:'Alerts manager',enabled:true})
  ModelRoles.set('APM manager',{role:'APM manager',enabled:true})
  ModelRoles.set('Applied Intelligence manager',{role:'Applied Intelligence manager',enabled:true})
  ModelRoles.set('Browser manager',{role:'Browser manager',enabled:true})
  ModelRoles.set('Data retention manager',{role:'Data retention manager',enabled:false})
  ModelRoles.set('Incident intelligence manager',{role:'Incident intelligence manager',enabled:true})
  ModelRoles.set('Incident workflows manager',{role:'Incident workflows manager',enabled:true})
  ModelRoles.set('Infrastructure manager',{role:'Infrastructure manager',enabled:false})
  ModelRoles.set('Insights manager',{role:'Insights manager',enabled:true})
  ModelRoles.set('Mobile manager',{role:'Mobile manager',enabled:true})
  ModelRoles.set('Nerdpack manager',{role:'Nerdpack manager',enabled:true})
  ModelRoles.set('Synthetics manager',{role:'Synthetics manager',enabled:true})
  ModelRoles.set('Workloads manager',{role:'Workloads manager',enabled:true})

  return ModelRoles
}


function FilterAccountList(accountlist){
  nlist = accountlist.filter((x) => {
    if (x.status == 'cancelled') {return false}
    if (GfilterSubAccountId == '' && GfilterMasterAccountId == '') {return true}
    if (GfilterSubAccountId > ''){
      if(x.id == GfilterSubAccountId) {return true} else {return false}
    }
    if (GfilterMasterAccountId > ''){
      if(x.parent_account_id == GfilterMasterAccountId) {return true} else {return false}
    }
    return false
  })
  //let's consistently work the accounts in numeric order
  nlist.sort((a, b) => (a.id > b.id) ? 1 : -1)
  console.log('testmain()->filtered Account List count:',GfilterMasterAccountId,GfilterSubAccountId,nlist.length)
  return nlist
}

async function main(updateFlag){
  console.log(`main(${updateFlag})-> start the party`)

  //load the model roles for comparison/setting
  modelroles = LoadModelRoles()

  //read user log for past runs
  userlog = ReadUserLog(Guserlogfilename)

  //get account list and filter to target subset
  accountlist = await GetAccountList(GpartnerId,GpartnerQueryKey)
  console.log(`${(new Date()).toISOString()}:main(${updateFlag})->accountlist:`,accountlist.length)
  filterlist = FilterAccountList(accountlist)
  if(GtestRunAcctLimit > 0 && filterlist.length > GtestRunAcctLimit) {console.log(`main(${updateFlag})-> acct limt`,GtestRunAcctLimit);filterlist = filterlist.slice(0,GtestRunAcctLimit)}

  //forcing Colin test accounts
  //filterlist = [{id:1977586,name:'surfing',parent_account_id:null}]

  //start the screen scraping
  await ScrapeBrowserUp()
  try {
    await ScrapeLoginManualCredentials(GloginURL)

    for (oAcct of filterlist) {
      console.log(`${(new Date()).toISOString()}:main(${updateFlag})-> looping for:`,oAcct.id, oAcct.name)
      userlist = await GetUserList(GpartnerId,GpartnerQueryKey,oAcct.id)
      if(GtestRunUserLimit > 0  && userlist.length > GtestRunUserLimit) {console.log('main()-> user limt',GtestRunUserLimit);userlist = userlist.slice(0,GtestRunUserLimit)}
      console.log(`${(new Date()).toISOString()}:main(${updateFlag})->userlist count:`,userlist.length)

      if( userlist.length > 0){
        await ScrapeLoop(oAcct.id,userlist, userlog, modelroles, updateFlag)
        amap = new Map()
        for (oUser of userlist){
          amap[oUser.change] = isNaN(amap[oUser.change]) ? 1 : amap[oUser.change] + 1
        }
        console.log(`main(${updateFlag})-> change dump`,oAcct.id, oAcct.name,amap)
      }
    }
  } finally {
    await ScrapeBrowserDown()
    CloseUserLog()
  }

  console.log(`${(new Date()).toISOString()}:main(${updateFlag})-> so long and thanks for all the fish`)
}


function ReadUserLog(filename){
  userlog = new Map()
  if(fs.existsSync(filename)){
    fs.createReadStream(filename)
      .pipe(csv())
      .on('data', (row) => {
        //debug line
        //console.log('LCF() row:',row)
        UserLogSet(userlog,row)
       })
      .on('end', () => {
        console.log('CSV file successfully processed', filename)
      });
  }
  return userlog
}

function UserLogSet(userlog,userobject){
  key = userobject.id.toString() + '/' + userobject.accountId.toString() + '/' + userobject.email.toLowerCase()
  userlog.set(key,userobject)
  //console.log('key,userobject:',key,userobject)
}

function UserLogTest(userlog,userobject){
  key = userobject.id.toString() + '/' + userobject.accountId.toString() + '/' + userobject.email.toLowerCase()
  //console.log('key:',key)
  return userlog.has(key)
}

function WriteUserLog (filename,oUser){
  if(GuserLogFileHandle == null){
    bExists = fs.existsSync(filename)
    GuserLogFileHandle = fs.openSync(filename,'a')
    if(!bExists){
      fs.writeFileSync(GuserLogFileHandle,'id,accountId,email\n')
    }
  }
  fs.appendFileSync(GuserLogFileHandle,oUser.id + ',' + oUser.accountId + ',"' + oUser.email + '"\n')
}

function CloseUserLog (){
  if(GuserLogFileHandle) {fs.closeSync(GuserLogFileHandle);GuserLogFileHandle=null}
}

//start the party
main(GupdateControlFlag)
