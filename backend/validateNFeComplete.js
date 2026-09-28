const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

// Função para validar estrutura completa da NF-e
function validateCompleteNFeStructure(xmlPath) {
    try {
        console.log(`\n=== VALIDAÇÃO COMPLETA DA NF-e ===`);
        console.log(`Arquivo: ${path.basename(xmlPath)}`);
        
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
        
        // 1. Verificar estrutura raiz
        console.log('\n1. VERIFICANDO ESTRUTURA RAIZ:');
        validateRootStructure(xmlContent);
        
        // 2. Verificar infNFe
        console.log('\n2. VERIFICANDO infNFe:');
        validateInfNFe(xmlContent);
        
        // 3. Verificar ide (identificação)
        console.log('\n3. VERIFICANDO ide (Identificação):');
        validateIde(xmlContent);
        
        // 4. Verificar emit (emitente)
        console.log('\n4. VERIFICANDO emit (Emitente):');
        validateEmit(xmlContent);
        
        // 5. Verificar dest (destinatário)
        console.log('\n5. VERIFICANDO dest (Destinatário):');
        validateDest(xmlContent);
        
        // 6. Verificar det (detalhes dos produtos)
        console.log('\n6. VERIFICANDO det (Detalhes):');
        validateDet(xmlContent);
        
        // 7. Verificar total
        console.log('\n7. VERIFICANDO total:');
        validateTotal(xmlContent);
        
        // 8. Verificar transp (transporte)
        console.log('\n8. VERIFICANDO transp (Transporte):');
        validateTransp(xmlContent);
        
        // 9. Verificar infAdic (informações adicionais)
        console.log('\n9. VERIFICANDO infAdic (Informações Adicionais):');
        validateInfAdic(xmlContent);
        
        // 10. Verificar elementos duplicados
        console.log('\n10. VERIFICANDO ELEMENTOS DUPLICADOS:');
        checkAllDuplicates(xmlContent);
        
        // 11. Verificar ordem dos elementos principais
        console.log('\n11. VERIFICANDO ORDEM DOS ELEMENTOS PRINCIPAIS:');
        validateMainElementsOrder(xmlContent);
        
    } catch (error) {
        console.error('❌ Erro na validação:', error.message);
    }
}

// Validar estrutura raiz
function validateRootStructure(xmlContent) {
    const hasNFeRoot = xmlContent.includes('<NFe') || xmlContent.includes('<nfeProc');
    const hasInfNFe = xmlContent.includes('<infNFe');
    
    if (hasNFeRoot) {
        console.log('✅ Elemento raiz NFe encontrado');
    } else {
        console.log('❌ Elemento raiz NFe não encontrado');
    }
    
    if (hasInfNFe) {
        console.log('✅ Elemento infNFe encontrado');
    } else {
        console.log('❌ Elemento infNFe não encontrado');
    }
}

// Validar infNFe
function validateInfNFe(xmlContent) {
    const infNFeMatch = xmlContent.match(/<infNFe[^>]*>/g);
    if (infNFeMatch) {
        console.log('✅ infNFe encontrado');
        
        // Verificar atributo Id
        const idMatch = infNFeMatch[0].match(/Id="([^"]+)"/);;
        if (idMatch) {
            const id = idMatch[1];
            console.log(`✅ Atributo Id: ${id}`);
            
            // Verificar formato do Id
            if (id.startsWith('NFe') && id.length === 47) {
                console.log('✅ Formato do Id está correto (NFe + 44 dígitos)');
            } else {
                console.log(`❌ Formato do Id incorreto. Esperado: NFe + 44 dígitos, encontrado: ${id}`);
            }
        } else {
            console.log('❌ Atributo Id não encontrado em infNFe');
        }
    } else {
        console.log('❌ infNFe não encontrado');
    }
}

// Validar ide (identificação)
function validateIde(xmlContent) {
    const ideMatch = xmlContent.match(/<ide[^>]*>([\s\S]*?)<\/ide>/g);
    if (!ideMatch) {
        console.log('❌ Elemento ide não encontrado');
        return;
    }
    
    const ideContent = ideMatch[0];
    
    // Elementos obrigatórios do ide
    const requiredIdeElements = [
        'cUF', 'cNF', 'natOp', 'mod', 'serie', 'nNF', 
        'dhEmi', 'tpNF', 'idDest', 'cMunFG', 'tpImp', 
        'tpEmis', 'cDV', 'tpAmb', 'finNFe', 'indFinal', 
        'indPres', 'procEmi', 'verProc'
    ];
    
    console.log('Verificando elementos obrigatórios do ide:');
    requiredIdeElements.forEach(element => {
        const regex = new RegExp(`<${element}[^>]*>([^<]+)<\/${element}>`);
        const match = ideContent.match(regex);
        if (match) {
            console.log(`  ✅ ${element}: ${match[1]}`);
        } else {
            console.log(`  ❌ ${element}: NÃO ENCONTRADO`);
        }
    });
}

// Validar emit (emitente)
function validateEmit(xmlContent) {
    const emitMatch = xmlContent.match(/<emit[^>]*>([\s\S]*?)<\/emit>/g);
    if (!emitMatch) {
        console.log('❌ Elemento emit não encontrado');
        return;
    }
    
    const emitContent = emitMatch[0];
    
    // Verificar CNPJ ou CPF
    const cnpjMatch = emitContent.match(/<CNPJ>([^<]+)<\/CNPJ>/);
    const cpfMatch = emitContent.match(/<CPF>([^<]+)<\/CPF>/);
    
    if (cnpjMatch) {
        console.log(`✅ CNPJ: ${cnpjMatch[1]}`);
    } else if (cpfMatch) {
        console.log(`✅ CPF: ${cpfMatch[1]}`);
    } else {
        console.log('❌ CNPJ ou CPF não encontrado');
    }
    
    // Verificar enderEmit
    const enderEmitMatch = emitContent.match(/<enderEmit[^>]*>([\s\S]*?)<\/enderEmit>/);
    if (enderEmitMatch) {
        console.log('✅ enderEmit encontrado');
        validateEnderEmit(enderEmitMatch[0]);
    } else {
        console.log('❌ enderEmit não encontrado');
    }
}

// Validar enderEmit (detalhado)
function validateEnderEmit(enderEmitXml) {
    console.log('  Validando enderEmit:');
    
    const expectedOrder = ['xLgr', 'nro', 'xCpl', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP', 'cPais', 'xPais', 'fone'];
    const requiredElements = ['xLgr', 'nro', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP'];
    
    const elementMatches = enderEmitXml.match(/<([^/>\s]+)[^>]*>([^<]*)<\/\1>/g) || [];
    const actualElements = elementMatches.map(el => {
        const match = el.match(/<([^>\s]+)/);
        return match ? match[1] : null;
    }).filter(Boolean);
    
    // Verificar elementos obrigatórios
    requiredElements.forEach(element => {
        if (actualElements.includes(element)) {
            console.log(`    ✅ ${element}: presente`);
        } else {
            console.log(`    ❌ ${element}: AUSENTE (obrigatório)`);
        }
    });
    
    // Verificar ordem
    let orderCorrect = true;
    let lastExpectedIndex = -1;
    
    actualElements.forEach((elementName, i) => {
        const expectedIndex = expectedOrder.indexOf(elementName);
        if (expectedIndex === -1) {
            console.log(`    ❌ Elemento inesperado: ${elementName}`);
            orderCorrect = false;
        } else if (expectedIndex < lastExpectedIndex) {
            console.log(`    ❌ Elemento fora de ordem: ${elementName}`);
            orderCorrect = false;
        } else {
            lastExpectedIndex = expectedIndex;
        }
    });
    
    if (orderCorrect) {
        console.log('    ✅ Ordem dos elementos está correta');
    }
}

// Validar dest (destinatário)
function validateDest(xmlContent) {
    const destMatch = xmlContent.match(/<dest[^>]*>([\s\S]*?)<\/dest>/g);
    if (destMatch) {
        console.log('✅ dest encontrado');
        
        const destContent = destMatch[0];
        const cnpjMatch = destContent.match(/<CNPJ>([^<]+)<\/CNPJ>/);
        const cpfMatch = destContent.match(/<CPF>([^<]+)<\/CPF>/);
        
        if (cnpjMatch || cpfMatch) {
            console.log(`✅ Documento: ${cnpjMatch ? cnpjMatch[1] : cpfMatch[1]}`);
        } else {
            console.log('❌ CNPJ ou CPF do destinatário não encontrado');
        }
    } else {
        console.log('⚠️  dest não encontrado (pode ser opcional para alguns casos)');
    }
}

// Validar det (detalhes)
function validateDet(xmlContent) {
    const detMatches = xmlContent.match(/<det[^>]*>([\s\S]*?)<\/det>/g);
    if (detMatches) {
        console.log(`✅ ${detMatches.length} item(ns) encontrado(s)`);
        
        detMatches.forEach((det, index) => {
            console.log(`  Item ${index + 1}:`);
            
            // Verificar prod
            const prodMatch = det.match(/<prod[^>]*>([\s\S]*?)<\/prod>/);
            if (prodMatch) {
                console.log('    ✅ prod encontrado');
            } else {
                console.log('    ❌ prod não encontrado');
            }
            
            // Verificar imposto
            const impostoMatch = det.match(/<imposto[^>]*>([\s\S]*?)<\/imposto>/);
            if (impostoMatch) {
                console.log('    ✅ imposto encontrado');
            } else {
                console.log('    ❌ imposto não encontrado');
            }
        });
    } else {
        console.log('❌ Nenhum item (det) encontrado');
    }
}

// Validar total
function validateTotal(xmlContent) {
    const totalMatch = xmlContent.match(/<total[^>]*>([\s\S]*?)<\/total>/g);
    if (totalMatch) {
        console.log('✅ total encontrado');
        
        const icmsTotMatch = totalMatch[0].match(/<ICMSTot[^>]*>([\s\S]*?)<\/ICMSTot>/);
        if (icmsTotMatch) {
            console.log('✅ ICMSTot encontrado');
        } else {
            console.log('❌ ICMSTot não encontrado');
        }
    } else {
        console.log('❌ total não encontrado');
    }
}

// Validar transp
function validateTransp(xmlContent) {
    const transpMatch = xmlContent.match(/<transp[^>]*>([\s\S]*?)<\/transp>/g);
    if (transpMatch) {
        console.log('✅ transp encontrado');
    } else {
        console.log('⚠️  transp não encontrado (pode ser opcional)');
    }
}

// Validar infAdic
function validateInfAdic(xmlContent) {
    const infAdicMatch = xmlContent.match(/<infAdic[^>]*>([\s\S]*?)<\/infAdic>/g);
    if (infAdicMatch) {
        console.log('✅ infAdic encontrado');
    } else {
        console.log('⚠️  infAdic não encontrado (opcional)');
    }
}

// Verificar todos os elementos duplicados
function checkAllDuplicates(xmlContent) {
    const elementsToCheck = ['xCpl', 'CNPJ', 'CPF', 'IE', 'cProd', 'xProd'];
    
    elementsToCheck.forEach(element => {
        const regex = new RegExp(`<${element}[^>]*>.*?<\/${element}>`, 'g');
        const matches = xmlContent.match(regex) || [];
        const emptyRegex = new RegExp(`<${element}\\s*\/>`, 'g');
        const emptyMatches = xmlContent.match(emptyRegex) || [];
        
        const totalMatches = matches.length + emptyMatches.length;
        
        if (totalMatches > 1) {
            console.log(`❌ ${element}: ${totalMatches} ocorrências encontradas (possível duplicação)`);
            matches.forEach((match, i) => {
                console.log(`    ${i + 1}. ${match}`);
            });
            emptyMatches.forEach((match, i) => {
                console.log(`    ${matches.length + i + 1}. ${match} (vazio)`);
            });
        } else if (totalMatches === 1) {
            console.log(`✅ ${element}: 1 ocorrência (OK)`);
        } else {
            console.log(`⚠️  ${element}: não encontrado`);
        }
    });
    
    // Verificação especial para xNome (pode aparecer em emit e dest legitimamente)
    const xNomeRegex = /<xNome[^>]*>.*?<\/xNome>/g;
    const xNomeMatches = xmlContent.match(xNomeRegex) || [];
    
    if (xNomeMatches.length === 2) {
        // Verifica se um está no emit e outro no dest
        const emitSection = xmlContent.match(/<emit[^>]*>[\s\S]*?<\/emit>/i)?.[0] || '';
        const destSection = xmlContent.match(/<dest[^>]*>[\s\S]*?<\/dest>/i)?.[0] || '';
        
        const xNomeInEmit = (emitSection.match(xNomeRegex) || []).length;
        const xNomeInDest = (destSection.match(xNomeRegex) || []).length;
        
        if (xNomeInEmit === 1 && xNomeInDest === 1) {
            console.log(`✅ xNome: 2 ocorrências (OK - 1 no emitente, 1 no destinatário)`);
        } else {
            console.log(`❌ xNome: ${xNomeMatches.length} ocorrências (duplicação anômala)`);
            xNomeMatches.forEach((match, i) => {
                console.log(`    ${i + 1}. ${match}`);
            });
        }
    } else if (xNomeMatches.length === 1) {
        console.log(`⚠️  xNome: apenas 1 ocorrência (pode estar faltando no emit ou dest)`);
    } else if (xNomeMatches.length > 2) {
        console.log(`❌ xNome: ${xNomeMatches.length} ocorrências (duplicação real)`);
        xNomeMatches.forEach((match, i) => {
            console.log(`    ${i + 1}. ${match}`);
        });
    } else {
        console.log(`⚠️  xNome: não encontrado`);
    }
}

// Validar ordem dos elementos principais
function validateMainElementsOrder(xmlContent) {
    const expectedMainOrder = ['ide', 'emit', 'dest', 'det', 'total', 'transp', 'infAdic'];
    
    const mainElements = [];
    expectedMainOrder.forEach(element => {
        const regex = new RegExp(`<${element}[^>]*>`);
        const match = xmlContent.match(regex);
        if (match) {
            const index = xmlContent.indexOf(match[0]);
            mainElements.push({ element, index });
        }
    });
    
    // Ordenar por posição no XML
    mainElements.sort((a, b) => a.index - b.index);
    
    console.log('Ordem encontrada:', mainElements.map(e => e.element).join(' → '));
    console.log('Ordem esperada:', expectedMainOrder.join(' → '));
    
    let orderCorrect = true;
    let lastExpectedIndex = -1;
    
    mainElements.forEach(({ element }) => {
        const expectedIndex = expectedMainOrder.indexOf(element);
        if (expectedIndex < lastExpectedIndex) {
            console.log(`❌ ${element} fora de ordem`);
            orderCorrect = false;
        } else {
            lastExpectedIndex = expectedIndex;
        }
    });
    
    if (orderCorrect) {
        console.log('✅ Ordem dos elementos principais está correta');
    }
}

// Função principal
function main() {
    const debugDir = '/Users/eduardotrindade/Projetos/consart/backend/public/faturamento/xml/debug';
    
    // Encontrar XMLs da NF-e (não arquivos SOAP de status)
    const files = fs.readdirSync(debugDir);
    
    // Filtrar apenas arquivos XML da NF-e (excluir SOAP, status, etc.)
    const nfeXmlFiles = files.filter(f => {
        return f.endsWith('.xml') && 
               !f.includes('SOAP') && 
               !f.includes('status') && 
               !f.includes('_req') && 
               !f.includes('_resp') && 
               (f.includes('nfe_') || f.includes('autorizacao_') || f.includes('xml_original') || f.includes('NFe'));
    }).sort().reverse(); // ← ORDENA E PEGA O MAIS RECENTE
    
    if (nfeXmlFiles.length === 0) {
        console.log('❌ Nenhum arquivo XML da NF-e encontrado!');
        console.log('\nArquivos XML disponíveis no diretório:');
        const allXmlFiles = files.filter(f => f.endsWith('.xml')).sort().reverse();
        allXmlFiles.slice(0, 10).forEach((f, i) => {
            console.log(`  ${i + 1}. ${f}`);
        });
        
        // Se não encontrar arquivos específicos da NF-e, tentar com qualquer XML que contenha estrutura de NF-e
        console.log('\nTentando encontrar XMLs que contenham estrutura de NF-e...');
        
        for (const file of allXmlFiles) {
            try {
                const filePath = path.join(debugDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                
                // Verificar se contém estrutura de NF-e
                if (content.includes('<infNFe') || content.includes('<NFe') || content.includes('<emit>')) {
                    console.log(`\n✅ Encontrado XML com estrutura de NF-e: ${file}`);
                    console.log(`Analisando: ${file}`);
                    validateCompleteNFeStructure(filePath);
                    return;
                }
            } catch (error) {
                // Ignorar erros de leitura
            }
        }
        
        console.log('❌ Nenhum XML com estrutura de NF-e encontrado!');
        return;
    }
    
    console.log('Arquivos XML da NF-e disponíveis:');
    nfeXmlFiles.slice(0, 5).forEach((f, i) => {
        console.log(`  ${i + 1}. ${f}`);
    });
    
    // Analisar o XML mais recente da NF-e
    const latestXML = path.join(debugDir, nfeXmlFiles[0]); // ← SEMPRE O PRIMEIRO (MAIS RECENTE)
    console.log(`\nAnalisando: ${nfeXmlFiles[0]}`);
    
    validateCompleteNFeStructure(latestXML);
    
    console.log('\n=== RESUMO DA VALIDAÇÃO ===');
    console.log('Execute este script para identificar todos os problemas estruturais da NF-e.');
    console.log('Qualquer ❌ indica um problema que pode estar causando o erro cStat 225.');
}

if (require.main === module) {
    main();
}

module.exports = {
    validateCompleteNFeStructure
};