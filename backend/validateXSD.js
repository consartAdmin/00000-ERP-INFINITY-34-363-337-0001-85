const fs = require('fs');
const path = require('path');
const libxmljs = require('libxmljs');

// Função para validar XML contra XSD
function validateXMLAgainstXSD(xmlPath, xsdPath) {
    try {
        console.log(`\n=== Validando XML contra XSD ===`);
        console.log(`XML: ${xmlPath}`);
        console.log(`XSD: ${xsdPath}`);
        
        // Carregar XSD
        const xsdDoc = fs.readFileSync(xsdPath, 'utf8');
        const xsdSchema = libxmljs.parseXml(xsdDoc);
        
        // Carregar XML
        const xmlDoc = fs.readFileSync(xmlPath, 'utf8');
        const xmlParsed = libxmljs.parseXml(xmlDoc);
        
        // Validar
        const isValid = xmlParsed.validate(xsdSchema);
        
        if (isValid) {
            console.log('✅ XML é válido segundo o schema XSD!');
            return true;
        } else {
            console.log('❌ XML NÃO é válido segundo o schema XSD!');
            console.log('\n=== ERROS DE VALIDAÇÃO ===');
            
            const errors = xmlParsed.validationErrors;
            errors.forEach((error, index) => {
                console.log(`\nErro ${index + 1}:`);
                console.log(`  Linha: ${error.line}`);
                console.log(`  Coluna: ${error.column}`);
                console.log(`  Mensagem: ${error.message}`);
                console.log(`  Código: ${error.code}`);
            });
            
            return false;
        }
    } catch (error) {
        console.error('Erro ao validar XML:', error.message);
        return false;
    }
}

// Função para analisar estrutura do enderEmit
function analyzeEnderEmitStructure(xmlPath) {
    try {
        console.log(`\n=== Analisando estrutura do enderEmit ===`);
        
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
        const xmlDoc = libxmljs.parseXml(xmlContent);
        
        // Buscar enderEmit
        const enderEmitNodes = xmlDoc.find('//enderEmit');
        
        if (enderEmitNodes.length === 0) {
            console.log('❌ Nenhum elemento enderEmit encontrado!');
            return;
        }
        
        enderEmitNodes.forEach((enderEmit, index) => {
            console.log(`\nenderEmit ${index + 1}:`);
            
            const children = enderEmit.childNodes();
            const elements = children.filter(node => node.type() === 'element');
            
            console.log('  Ordem dos elementos:');
            elements.forEach((element, i) => {
                const name = element.name();
                const text = element.text().trim();
                console.log(`    ${i + 1}. <${name}>${text}</${name}>`);
            });
            
            // Verificar ordem correta
            const expectedOrder = ['xLgr', 'nro', 'xCpl', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP', 'cPais', 'xPais', 'fone'];
            const actualOrder = elements.map(el => el.name());
            
            console.log('\n  Verificação de ordem:');
            let orderCorrect = true;
            let lastExpectedIndex = -1;
            
            actualOrder.forEach((elementName, i) => {
                const expectedIndex = expectedOrder.indexOf(elementName);
                if (expectedIndex === -1) {
                    console.log(`    ❌ Elemento inesperado: ${elementName}`);
                    orderCorrect = false;
                } else if (expectedIndex < lastExpectedIndex) {
                    console.log(`    ❌ Elemento fora de ordem: ${elementName} (posição ${i + 1})`);
                    orderCorrect = false;
                } else {
                    console.log(`    ✅ ${elementName} (posição ${i + 1})`);
                    lastExpectedIndex = expectedIndex;
                }
            });
            
            if (orderCorrect) {
                console.log('  ✅ Ordem dos elementos está correta!');
            } else {
                console.log('  ❌ Ordem dos elementos está incorreta!');
            }
        });
        
    } catch (error) {
        console.error('Erro ao analisar enderEmit:', error.message);
    }
}

// Função principal
function main() {
    const debugDir = '/Users/eduardotrindade/Projetos/consart/backend/public/faturamento/xml/debug';
    const layoutDir = '/Users/eduardotrindade/Projetos/consart/backend/public/layout';
    
    // Encontrar o XML mais recente
    const files = fs.readdirSync(debugDir);
    const xmlFiles = files.filter(f => f.includes('nfe_assinada.xml')).sort().reverse();
    
    if (xmlFiles.length === 0) {
        console.log('❌ Nenhum arquivo nfe_assinada.xml encontrado!');
        return;
    }
    
    const latestXML = path.join(debugDir, xmlFiles[0]);
    const xsdPath = path.join(layoutDir, 'nfe_v4.00.xsd');
    
    console.log('=== VALIDADOR XSD NF-e ===');
    console.log(`Arquivo XML mais recente: ${xmlFiles[0]}`);
    
    // Analisar estrutura do enderEmit
    analyzeEnderEmitStructure(latestXML);
    
    // Validar contra XSD
    validateXMLAgainstXSD(latestXML, xsdPath);
}

if (require.main === module) {
    main();
}

module.exports = {
    validateXMLAgainstXSD,
    analyzeEnderEmitStructure
};